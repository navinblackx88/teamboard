import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiUploadLimitMb, env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { attachments, users } from "../../db/schema.js";
import { assertTask } from "../../lib/access.js";
import { badRequest, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { can } from "../../lib/rbac.js";
import { storage } from "../../lib/storage.js";
import { body, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { publicUserColumns } from "../users/user.serializer.js";

export const taskAttachmentsRouter = Router({ mergeParams: true });
export const attachmentRouter = Router();
export const publicFileRouter = Router();

const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|ps1|vbs|jar|sh)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: apiUploadLimitMb * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => (BLOCKED.test(file.originalname) ? cb(badRequest(`File type not allowed: ${file.originalname}`)) : cb(null, true)),
});

// multer decodes filenames as latin1; recover UTF-8 names.
const fixName = (n: string) => Buffer.from(n, "latin1").toString("utf8");
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").slice(-120);

const withUploader = (where: ReturnType<typeof eq>) => db.select({ attachment: attachments, uploader: publicUserColumns })
  .from(attachments).leftJoin(users, eq(users.id, attachments.uploaderId)).where(where);
const shape = (r: { attachment: typeof attachments.$inferSelect; uploader: unknown }) => {
  const { storageKey: _k, ...a } = r.attachment;
  return { ...a, uploader: (r.uploader as { id?: string })?.id ? r.uploader : null };
};

taskAttachmentsRouter.get("/", async (req, res) => {
  const { task } = await assertTask(me(req), uuidParam(req, "tid"));
  const rows = await withUploader(eq(attachments.taskId, task.id)).orderBy(desc(attachments.createdAt));
  res.json({ items: rows.map(shape) });
});

type Ctx = Awaited<ReturnType<typeof assertTask>>;
const keyPrefix = ({ task, project }: Ctx) => `${project.workspaceId}/${project.id}/${task.id}/`;

/** Records stored files as attachments, logs activity and notifies the project room. */
async function recordAttachments(actorId: string, ctx: Ctx, files: { key: string; filename: string; mimeType: string; size: number }[]) {
  const { task, project } = ctx;
  const created = [];
  for (const f of files) {
    const [row] = await db.insert(attachments).values({
      taskId: task.id, uploaderId: actorId, filename: f.filename, mimeType: f.mimeType || "application/octet-stream", sizeBytes: f.size, storageKey: f.key,
    }).returning();
    created.push(row);
  }
  const rows = await Promise.all(created.map((c) => withUploader(eq(attachments.id, c.id)).then((r) => shape(r[0]))));
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId, action: "attachment.created", entityType: "attachment",
    entityId: created[0].id, summary: `attached ${created.length === 1 ? created[0].filename : `${created.length} files`} to ${project.key}-${task.number}` });
  broadcast.project(project.id, "attachment.created", { taskId: task.id, attachments: rows, actorId });
  return rows;
}

taskAttachmentsRouter.post("/", upload.array("files", 10), async (req, res) => {
  const actor = me(req);
  const ctx = await assertTask(actor, uuidParam(req, "tid"), "file:upload");
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest("Attach at least one file in the 'files' field");

  const stored = [];
  for (const f of files) {
    const filename = fixName(f.originalname);
    const key = `${keyPrefix(ctx)}${crypto.randomUUID()}-${safeName(filename)}`;
    await storage.put(key, f.buffer, f.mimetype);
    stored.push({ key, filename, mimeType: f.mimetype, size: f.size });
  }
  res.status(201).json({ items: await recordAttachments(actor.id, ctx, stored) });
});

// ─── Direct-to-storage uploads (DIRECT_UPLOADS=true) ────────────────────────
// 1. POST /uploads with file metadata → presigned PUT URLs.  2. Browser PUTs each file to storage.
// 3. POST /uploads/complete with the keys → attachments are recorded. Used on Vercel, whose functions
//    reject request bodies over 4.5 MB.
const fileMeta = z.object({ filename: z.string().min(1).max(255), mimeType: z.string().max(200).default("application/octet-stream"), size: z.number().int().positive() });
const directOnly = () => { if (!env.DIRECT_UPLOADS || !storage.uploadUrl) throw badRequest("Direct uploads are not enabled; POST multipart to /attachments instead"); };

taskAttachmentsRouter.post("/uploads", async (req, res) => {
  directOnly();
  const ctx = await assertTask(me(req), uuidParam(req, "tid"), "file:upload");
  const { files } = body(req, z.object({ files: z.array(fileMeta).min(1).max(10) }));
  const max = env.MAX_UPLOAD_MB * 1024 * 1024;
  for (const f of files) {
    if (BLOCKED.test(f.filename)) throw badRequest(`File type not allowed: ${f.filename}`);
    if (f.size > max) throw badRequest(`${f.filename} is larger than ${env.MAX_UPLOAD_MB} MB`);
  }
  const items = await Promise.all(files.map(async (f) => {
    const key = `${keyPrefix(ctx)}${crypto.randomUUID()}-${safeName(f.filename)}`;
    return { key, filename: f.filename, url: await storage.uploadUrl!(key, f.mimeType, f.size), headers: { "Content-Type": f.mimeType } };
  }));
  res.status(201).json({ items, expiresInSeconds: 600 });
});

taskAttachmentsRouter.post("/uploads/complete", async (req, res) => {
  directOnly();
  const actor = me(req);
  const ctx = await assertTask(actor, uuidParam(req, "tid"), "file:upload");
  const { files } = body(req, z.object({ files: z.array(z.object({ key: z.string().max(400), filename: z.string().min(1).max(255), mimeType: z.string().max(200).default("application/octet-stream") })).min(1).max(10) }));
  const stored = [];
  for (const f of files) {
    // Keys are only accepted for this task's folder, and the object must really be in storage.
    if (!f.key.startsWith(keyPrefix(ctx)) || f.key.includes("..")) throw badRequest("Upload key does not belong to this task");
    const [dupe] = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storageKey, f.key));
    if (dupe) throw badRequest(`${f.filename} is already attached`);
    const size = await storage.size!(f.key);
    if (size === null) throw badRequest(`${f.filename} hasn't finished uploading`);
    stored.push({ key: f.key, filename: f.filename, mimeType: f.mimeType, size });
  }
  res.status(201).json({ items: await recordAttachments(actor.id, ctx, stored) });
});

async function loadAttachment(id: string, actorId: string) {
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!a) throw notFound("Attachment");
  const ctx = await assertTask({ id: actorId }, a.taskId);
  return { attachment: a, ...ctx };
}

/** Short-lived URL a browser can open directly (presigned S3 URL, or a signed API link for local storage). */
async function downloadUrl(a: typeof attachments.$inferSelect) {
  const direct = await storage.downloadUrl(a.storageKey, a.filename);
  if (direct) return direct;
  const sig = jwt.sign({ aid: a.id }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  return `${env.API_URL}/api/v1/files/${a.id}?sig=${sig}`;
}

attachmentRouter.get("/:aid/url", async (req, res) => {
  const { attachment } = await loadAttachment(uuidParam(req, "aid"), me(req).id);
  res.json({ url: await downloadUrl(attachment), expiresInSeconds: 300 });
});

attachmentRouter.get("/:aid/download", async (req, res) => {
  const { attachment } = await loadAttachment(uuidParam(req, "aid"), me(req).id);
  const direct = await storage.downloadUrl(attachment.storageKey, attachment.filename);
  if (direct) return res.redirect(302, direct);
  sendFile(res, attachment, await storage.read(attachment.storageKey));
});

attachmentRouter.delete("/:aid", async (req, res) => {
  const actor = me(req);
  const { attachment, project, role, task } = await loadAttachment(uuidParam(req, "aid"), actor.id);
  if (attachment.uploaderId !== actor.id && !can(role, "file:moderate")) throw forbidden("Only the uploader or a project manager can delete this file");
  await db.delete(attachments).where(eq(attachments.id, attachment.id));
  await storage.remove(attachment.storageKey);
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId: actor.id, action: "attachment.deleted", entityType: "attachment",
    entityId: attachment.id, summary: `removed ${attachment.filename} from ${project.key}-${task.number}` });
  broadcast.project(project.id, "attachment.deleted", { taskId: task.id, attachmentId: attachment.id, actorId: actor.id });
  res.status(204).end();
});

/** Signed download for local storage — no bearer header needed, so plain <a href> links work. */
publicFileRouter.get("/:aid", async (req, res) => {
  try {
    const { aid } = jwt.verify(String(req.query.sig ?? ""), env.JWT_ACCESS_SECRET) as { aid: string };
    if (aid !== req.params.aid) throw new Error();
  } catch { throw unauthorized("Download link is invalid or has expired"); }
  const [a] = await db.select().from(attachments).where(eq(attachments.id, String(req.params.aid)));
  if (!a) throw notFound("Attachment");
  sendFile(res, a, await storage.read(a.storageKey));
});

function sendFile(res: import("express").Response, a: typeof attachments.$inferSelect, data: Buffer) {
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("Content-Length", data.length);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
}
