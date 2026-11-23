import { Router } from "express";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { invitations, roleEnum, users, workspaceMembers, workspaces } from "../../db/schema.js";
import { assertWorkspace } from "../../lib/access.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { sendEmail } from "../../lib/mailer.js";
import { rolePermissions, roleRank } from "../../lib/rbac.js";
import { randomToken, sha256 } from "../../lib/tokens.js";
import { body, query, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { notify } from "../notifications/notification.service.js";
import { publicUserColumns } from "../users/user.serializer.js";
import { acceptInvitation, findInvitation } from "./invitation.service.js";

export const workspaceRouter = Router();
export const invitationPublicRouter = Router();

const role = z.enum(roleEnum.enumValues);
const settingsSchema = z.object({
  defaultRole: z.enum(["developer", "viewer"]).optional(),
  allowedEmailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).optional(),
  timezone: z.string().max(64).optional(),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "workspace";

workspaceRouter.get("/", async (req, res) => {
  const rows = await db.select({
    id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role, createdAt: workspaces.createdAt,
    memberCount: sql<number>`(select count(*)::int from workspace_members m where m.workspace_id = ${workspaces.id})`,
  }).from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, me(req).id)).orderBy(workspaces.name);
  res.json({ items: rows });
});

workspaceRouter.post("/", async (req, res) => {
  const input = body(req, z.object({ name: z.string().trim().min(1).max(120) }));
  const user = me(req);
  const ws = await db.transaction(async (tx) => {
    const base = slugify(input.name);
    const [{ n }] = await tx.select({ n: count() }).from(workspaces).where(sql`${workspaces.slug} ~ ${`^${base}(-[0-9]+)?$`}`);
    const [created] = await tx.insert(workspaces).values({
      name: input.name, slug: n ? `${base}-${n + 1}` : base, ownerId: user.id,
    }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: created.id, userId: user.id, role: "admin" });
    return created;
  });
  await logActivity({ workspaceId: ws.id, actorId: user.id, action: "workspace.created", entityType: "workspace", entityId: ws.id, summary: `created workspace ${ws.name}` });
  res.status(201).json({ ...ws, role: "admin" });
});

workspaceRouter.get("/:wid", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const { role: myRole } = await assertWorkspace(me(req), wid);
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  res.json({ ...ws, role: myRole, permissions: [...rolePermissions[myRole]] });
});

workspaceRouter.patch("/:wid", async (req, res) => {
  const wid = uuidParam(req, "wid");
  await assertWorkspace(me(req), wid, "workspace:update");
  const input = body(req, z.object({ name: z.string().trim().min(1).max(120).optional(), settings: settingsSchema.optional() }));
  const [current] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  const [ws] = await db.update(workspaces).set({
    name: input.name, settings: input.settings ? { ...current.settings, ...input.settings } : undefined,
  }).where(eq(workspaces.id, wid)).returning();
  await logActivity({ workspaceId: wid, actorId: me(req).id, action: "workspace.updated", entityType: "workspace", entityId: wid, summary: "updated workspace settings", metadata: input });
  res.json(ws);
});

workspaceRouter.delete("/:wid", async (req, res) => {
  const wid = uuidParam(req, "wid");
  await assertWorkspace(me(req), wid, "workspace:delete");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  if (ws.ownerId !== me(req).id) throw forbidden("Only the workspace owner can delete it");
  await db.delete(workspaces).where(eq(workspaces.id, wid));
  res.status(204).end();
});

// ─── Members ─────────────────────────────────────────────────────────────────
workspaceRouter.get("/:wid/members", async (req, res) => {
  const wid = uuidParam(req, "wid");
  await assertWorkspace(me(req), wid);
  const { q } = query(req, z.object({ q: z.string().trim().max(100).optional() }));
  const rows = await db.select({ ...publicUserColumns, role: workspaceMembers.role, joinedAt: workspaceMembers.joinedAt })
    .from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, wid), q ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined))
    .orderBy(users.name);
  res.json({ items: rows });
});

async function adminCount(wid: string) {
  const [{ n }] = await db.select({ n: count() }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.role, "admin")));
  return n;
}

workspaceRouter.patch("/:wid/members/:uid", async (req, res) => {
  const wid = uuidParam(req, "wid"); const uid = uuidParam(req, "uid");
  await assertWorkspace(me(req), wid, "members:manage");
  const { role: newRole } = body(req, z.object({ role }));
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  const [member] = await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, uid)));
  if (!member) throw notFound("Member");
  if (uid === ws.ownerId && newRole !== "admin") throw forbidden("The workspace owner must remain an admin");
  if (member.role === "admin" && newRole !== "admin" && (await adminCount(wid)) <= 1) throw badRequest("A workspace needs at least one admin");
  const [updated] = await db.update(workspaceMembers).set({ role: newRole })
    .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, uid))).returning();
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, uid));
  await logActivity({ workspaceId: wid, actorId: me(req).id, action: "member.role_changed", entityType: "member", entityId: uid,
    summary: `changed ${u.name}'s role from ${member.role.replace("_", " ")} to ${newRole.replace("_", " ")}`, metadata: { from: member.role, to: newRole } });
  broadcast.workspace(wid, "member.changed", { userId: uid });
  res.json(updated);
});

workspaceRouter.delete("/:wid/members/:uid", async (req, res) => {
  const wid = uuidParam(req, "wid"); const uid = uuidParam(req, "uid");
  const actor = me(req);
  const leavingSelf = uid === actor.id;
  await assertWorkspace(actor, wid, leavingSelf ? "read" : "members:manage");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  if (uid === ws.ownerId) throw forbidden("The workspace owner cannot be removed");
  const [removed] = await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, uid))).returning();
  if (!removed) throw notFound("Member");
  await logActivity({ workspaceId: wid, actorId: actor.id, action: leavingSelf ? "member.left" : "member.removed", entityType: "member", entityId: uid,
    summary: leavingSelf ? "left the workspace" : "removed a member from the workspace" });
  broadcast.workspace(wid, "member.changed", { userId: uid });
  res.status(204).end();
});

// ─── Invitations ─────────────────────────────────────────────────────────────
workspaceRouter.get("/:wid/invitations", async (req, res) => {
  const wid = uuidParam(req, "wid");
  await assertWorkspace(me(req), wid, "invites:manage");
  const rows = await db.select({
    id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt,
    invitedBy: { id: users.id, name: users.name },
  }).from(invitations).innerJoin(users, eq(users.id, invitations.invitedById))
    .where(and(eq(invitations.workspaceId, wid), isNull(invitations.acceptedAt))).orderBy(desc(invitations.createdAt));
  res.json({ items: rows });
});

workspaceRouter.post("/:wid/invitations", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const actor = me(req);
  const { role: actorRole } = await assertWorkspace(actor, wid, "invites:manage");
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
  const input = body(req, z.object({
    email: z.email().transform((s) => s.trim().toLowerCase()),
    role: role.default(ws.settings.defaultRole ?? "developer"),
  }));
  if (roleRank[input.role] > roleRank[actorRole]) throw forbidden("You cannot invite someone with a higher role than your own");
  const domains = ws.settings.allowedEmailDomains ?? [];
  if (domains.length && !domains.includes(input.email.split("@")[1])) {
    throw badRequest(`Only these email domains may join: ${domains.join(", ")}`);
  }
  const [existing] = await db.select({ id: users.id }).from(users)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, wid)))
    .where(sql`lower(${users.email}) = ${input.email}`);
  if (existing) throw conflict("That person is already a member of this workspace");

  const token = randomToken();
  const [inv] = await db.insert(invitations).values({
    workspaceId: wid, email: input.email, role: input.role, tokenHash: sha256(token),
    invitedById: actor.id, expiresAt: new Date(Date.now() + 7 * 86400_000),
  }).returning();
  const link = `/invite/${token}`;
  const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id));
  void sendEmail(input.email, `${inviter.name} invited you to ${ws.name} on TeamBoard`,
    `${inviter.name} invited you to join the ${ws.name} workspace as ${input.role.replace("_", " ")}. The invitation expires in 7 days.`, link);

  // If they already have an account, also notify them in-app.
  const [invitee] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
  if (invitee) await notify({ userIds: [invitee.id], type: "invited", title: `You've been invited to ${ws.name}`, link, email: false });

  await logActivity({ workspaceId: wid, actorId: actor.id, action: "member.invited", entityType: "member", entityId: inv.id,
    summary: `invited ${input.email} as ${input.role.replace("_", " ")}` });
  res.status(201).json({
    id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt,
    inviteUrl: `${env.APP_URL}${link}`, // shown to the inviter so the link can also be shared directly
  });
});

workspaceRouter.delete("/:wid/invitations/:iid", async (req, res) => {
  const wid = uuidParam(req, "wid"); const iid = uuidParam(req, "iid");
  await assertWorkspace(me(req), wid, "invites:manage");
  const [r] = await db.delete(invitations).where(and(eq(invitations.id, iid), eq(invitations.workspaceId, wid))).returning();
  if (!r) throw notFound("Invitation");
  res.status(204).end();
});

// Public preview (no auth) so the invite page can show what's being joined.
invitationPublicRouter.get("/:token", async (req, res) => {
  const { invitation: inv, workspaceName, invitedByName } = await findInvitation(String(req.params.token));
  res.json({
    workspaceName, invitedByName, email: inv.email, role: inv.role, expiresAt: inv.expiresAt,
    status: inv.acceptedAt ? "accepted" : inv.expiresAt < new Date() ? "expired" : "pending",
  });
});

export const invitationAcceptRouter = Router();
invitationAcceptRouter.post("/:token/accept", async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, me(req).id));
  res.json(await acceptInvitation(String(req.params.token), user));
});
