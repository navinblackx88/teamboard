import { Router } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { comments, taskAssignees, users, workspaceMembers } from "../../db/schema.js";
import { assertTask } from "../../lib/access.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { can } from "../../lib/rbac.js";
import { body, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { notify } from "../notifications/notification.service.js";
import { publicUserColumns, type PublicUser } from "../users/user.serializer.js";

export const taskCommentsRouter = Router({ mergeParams: true });
export const commentRouter = Router();

/**
 * Mentions are stored inline as `@[Display Name](user-uuid)`, which the editor
 * inserts when a user is picked. Plain text renders fine if markup is ignored.
 */
const MENTION = /@\[([^\]]{1,120})\]\(([0-9a-f-]{36})\)/gi;
export const extractMentions = (text: string) => [...new Set([...text.matchAll(MENTION)].map((m) => m[2].toLowerCase()))];
const plain = (text: string) => text.replace(MENTION, "@$1");

type CommentNode = typeof comments.$inferSelect & { author: PublicUser | null; replies: CommentNode[] };

async function loadComment(commentId: string) {
  const [row] = await db.select({ comment: comments, author: publicUserColumns }).from(comments)
    .leftJoin(users, eq(users.id, comments.authorId)).where(eq(comments.id, commentId));
  if (!row) throw notFound("Comment");
  return { ...row.comment, author: row.author?.id ? row.author : null, replies: [] } as CommentNode;
}

const redact = (c: CommentNode): CommentNode => (c.deletedAt ? { ...c, body: "", mentionedUserIds: [] } : c);

taskCommentsRouter.get("/", async (req, res) => {
  const { task } = await assertTask(me(req), uuidParam(req, "tid"));
  const rows = await db.select({ comment: comments, author: publicUserColumns }).from(comments)
    .leftJoin(users, eq(users.id, comments.authorId)).where(eq(comments.taskId, task.id)).orderBy(asc(comments.createdAt));
  const nodes = new Map<string, CommentNode>(rows.map((r) => [r.comment.id, redact({ ...r.comment, author: r.author?.id ? r.author : null, replies: [] })]));
  const roots: CommentNode[] = [];
  for (const n of nodes.values()) (n.parentId && nodes.get(n.parentId) ? nodes.get(n.parentId)!.replies : roots).push(n);
  // Drop deleted comments that have no surviving replies.
  const prune = (list: CommentNode[]): CommentNode[] => list
    .map((n) => ({ ...n, replies: prune(n.replies) }))
    .filter((n) => !n.deletedAt || n.replies.length);
  res.json({ items: prune(roots), total: rows.filter((r) => !r.comment.deletedAt).length });
});

taskCommentsRouter.post("/", async (req, res) => {
  const actor = me(req);
  const { task, project } = await assertTask(actor, uuidParam(req, "tid"), "comment:create");
  const input = body(req, z.object({ body: z.string().trim().min(1).max(20_000), parentId: z.uuid().optional() }));
  if (input.parentId) {
    const [parent] = await db.select().from(comments).where(eq(comments.id, input.parentId));
    if (!parent || parent.taskId !== task.id) throw badRequest("Parent comment must belong to the same task");
  }

  // Only real workspace members can be mentioned.
  const mentioned = extractMentions(input.body);
  const valid = mentioned.length ? (await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), inArray(workspaceMembers.userId, mentioned)))).map((r) => r.id) : [];

  const [created] = await db.insert(comments).values({
    taskId: task.id, authorId: actor.id, parentId: input.parentId, body: input.body, mentionedUserIds: valid,
  }).returning();
  const view = await loadComment(created.id);
  const key = `${project.key}-${task.number}`;
  const link = `/projects/${project.id}/board?task=${task.id}`;
  const snippet = plain(input.body).slice(0, 200);

  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId: actor.id, action: "comment.created",
    entityType: "comment", entityId: created.id, summary: `commented on ${key}`, metadata: { snippet: snippet.slice(0, 120) } });
  broadcast.project(project.id, "comment.created", { taskId: task.id, comment: view, actorId: actor.id });

  const actorName = view.author?.name ?? "Someone";
  await notify({ userIds: valid, exclude: actor.id, type: "mentioned", workspaceId: project.workspaceId,
    title: `${actorName} mentioned you on ${key}`, body: snippet, link, data: { taskId: task.id, commentId: created.id } });

  // Everyone else involved: assignees, reporter, and earlier commenters (minus those already @mentioned).
  const [assignees, commenters] = await Promise.all([
    db.select({ id: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id)),
    db.selectDistinct({ id: comments.authorId }).from(comments).where(eq(comments.taskId, task.id)),
  ]);
  const watchers = [...assignees.map((a) => a.id), ...commenters.map((c) => c.id!).filter(Boolean), task.reporterId!]
    .filter((id) => id && !valid.includes(id));
  await notify({ userIds: watchers, exclude: actor.id, type: "comment_added", workspaceId: project.workspaceId,
    title: `${actorName} commented on ${key}: ${task.title}`, body: snippet, link, data: { taskId: task.id, commentId: created.id } });

  res.status(201).json(view);
});

async function ownComment(commentId: string, actorId: string, moderatePerm: boolean) {
  const [c] = await db.select().from(comments).where(eq(comments.id, commentId));
  if (!c || c.deletedAt) throw notFound("Comment");
  const { project, role } = await assertTask({ id: actorId }, c.taskId);
  if (c.authorId !== actorId && !(moderatePerm && can(role, "comment:moderate"))) throw forbidden("You can only change your own comments");
  return { comment: c, project };
}

commentRouter.patch("/:cid", async (req, res) => {
  const actor = me(req);
  const { comment, project } = await ownComment(uuidParam(req, "cid"), actor.id, false);
  const input = body(req, z.object({ body: z.string().trim().min(1).max(20_000) }));
  await db.update(comments).set({ body: input.body, editedAt: new Date(), mentionedUserIds: extractMentions(input.body) }).where(eq(comments.id, comment.id));
  const view = await loadComment(comment.id);
  broadcast.project(project.id, "comment.updated", { taskId: comment.taskId, comment: view, actorId: actor.id });
  res.json(view);
});

commentRouter.delete("/:cid", async (req, res) => {
  const actor = me(req);
  const { comment, project } = await ownComment(uuidParam(req, "cid"), actor.id, true);
  // Soft delete keeps reply threads intact; the body is hidden from readers.
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, comment.id));
  broadcast.project(project.id, "comment.deleted", { taskId: comment.taskId, commentId: comment.id, actorId: actor.id });
  res.status(204).end();
});
