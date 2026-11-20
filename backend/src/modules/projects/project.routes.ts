import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  labels, projectMembers, projects, projectStatusEnum, sprints, users, workspaceMembers,
} from "../../db/schema.js";
import { assertProject, assertWorkspace } from "../../lib/access.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { rolePermissions } from "../../lib/rbac.js";
import { body, query, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { publicUserColumns } from "../users/user.serializer.js";

export const workspaceProjectsRouter = Router({ mergeParams: true });
export const projectRouter = Router();
export const labelRouter = Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1");
const DEFAULT_LABELS = [
  { name: "bug", color: "#ef4444" }, { name: "feature", color: "#22c55e" },
  { name: "improvement", color: "#3b82f6" }, { name: "chore", color: "#64748b" },
];

/** Users must already belong to the workspace before being added to a project. */
async function assertWorkspaceMembers(workspaceId: string, userIds: string[]) {
  if (!userIds.length) return;
  const found = await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, userIds)));
  if (found.length !== new Set(userIds).size) throw badRequest("All users must be members of the workspace");
}

const projectStats = sql<{ total: number; done: number; inProgress: number; review: number; backlog: number }>`(
  select json_build_object(
    'total', count(*)::int,
    'done', count(*) filter (where t.status = 'done')::int,
    'inProgress', count(*) filter (where t.status = 'in_progress')::int,
    'review', count(*) filter (where t.status = 'review')::int,
    'backlog', count(*) filter (where t.status = 'backlog')::int)
  from tasks t where t.project_id = "projects"."id" and t.parent_id is null)`;

workspaceProjectsRouter.get("/", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const actor = me(req);
  const { role } = await assertWorkspace(actor, wid);
  const { status } = query(req, z.object({ status: z.enum(projectStatusEnum.enumValues).optional() }));
  const seesAll = role === "admin" || role === "project_manager";
  const rows = await db.select({
    project: projects,
    stats: projectStats,
    memberCount: sql<number>`(select count(*)::int from project_members pm where pm.project_id = "projects"."id")`,
    activeSprint: sql<{ id: string; name: string; endDate: string | null } | null>`(
      select json_build_object('id', s.id, 'name', s.name, 'endDate', s.end_date)
      from sprints s where s.project_id = "projects"."id" and s.status = 'active' limit 1)`,
  }).from(projects).where(and(
    eq(projects.workspaceId, wid),
    status ? eq(projects.status, status) : undefined,
    seesAll ? undefined : sql`exists (select 1 from project_members pm where pm.project_id = "projects"."id" and pm.user_id = ${actor.id})`,
  )).orderBy(projects.name);
  res.json({ items: rows.map((r) => ({ ...r.project, stats: r.stats, memberCount: r.memberCount, activeSprint: r.activeSprint })) });
});

workspaceProjectsRouter.post("/", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const actor = me(req);
  await assertWorkspace(actor, wid, "project:create");
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120),
    key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, "Key must be 2–10 letters/digits, starting with a letter"),
    description: z.string().max(10_000).optional(),
    color: color.optional(),
    leadId: z.uuid().optional(),
    memberIds: z.array(z.uuid()).max(200).default([]),
  }));
  const memberIds = [...new Set([actor.id, ...input.memberIds, ...(input.leadId ? [input.leadId] : [])])];
  await assertWorkspaceMembers(wid, memberIds);
  const [dupe] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, wid), eq(projects.key, input.key)));
  if (dupe) throw conflict(`Project key ${input.key} is already used in this workspace`);

  const project = await db.transaction(async (tx) => {
    const [p] = await tx.insert(projects).values({
      workspaceId: wid, name: input.name, key: input.key, description: input.description,
      color: input.color, leadId: input.leadId ?? actor.id,
    }).returning();
    await tx.insert(projectMembers).values(memberIds.map((userId) => ({ projectId: p.id, userId })));
    await tx.insert(labels).values(DEFAULT_LABELS.map((l) => ({ ...l, projectId: p.id })));
    return p;
  });
  await logActivity({ workspaceId: wid, projectId: project.id, actorId: actor.id, action: "project.created", entityType: "project", entityId: project.id, summary: `created project ${project.name}` });
  res.status(201).json(project);
});

// ─── Single project ──────────────────────────────────────────────────────────
projectRouter.get("/:pid", async (req, res) => {
  const { project, role } = await assertProject(me(req), uuidParam(req, "pid"));
  const [members, projectLabels, [activeSprint]] = await Promise.all([
    db.select(publicUserColumns).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, project.id)).orderBy(users.name),
    db.select().from(labels).where(eq(labels.projectId, project.id)).orderBy(labels.name),
    db.select().from(sprints).where(and(eq(sprints.projectId, project.id), eq(sprints.status, "active"))),
  ]);
  res.json({ ...project, members, labels: projectLabels, activeSprint: activeSprint ?? null, role, permissions: [...rolePermissions[role]] });
});

projectRouter.patch("/:pid", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "project:update");
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(10_000).nullable().optional(),
    status: z.enum(projectStatusEnum.enumValues).optional(),
    color: color.optional(),
    leadId: z.uuid().nullable().optional(),
    settings: z.object({
      defaultSprintLengthDays: z.number().int().min(1).max(60).optional(),
      wipLimits: z.record(z.enum(["backlog", "in_progress", "review", "done"]), z.number().int().min(0).max(999)).optional(),
    }).optional(),
  }));
  if (input.leadId) await assertWorkspaceMembers(project.workspaceId, [input.leadId]);
  const [updated] = await db.update(projects).set({
    ...input, settings: input.settings ? { ...project.settings, ...input.settings } : undefined,
  }).where(eq(projects.id, project.id)).returning();
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: input.status === "archived" ? "project.archived" : "project.updated",
    entityType: "project", entityId: project.id, summary: input.status === "archived" ? `archived project ${project.name}` : `updated project ${updated.name}`, metadata: input });
  broadcast.project(project.id, "project.updated", { project: updated, actorId: actor.id });
  res.json(updated);
});

projectRouter.delete("/:pid", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "project:delete");
  await db.delete(projects).where(eq(projects.id, project.id));
  await logActivity({ workspaceId: project.workspaceId, actorId: actor.id, action: "project.deleted", entityType: "project", entityId: project.id, summary: `deleted project ${project.name}` });
  broadcast.project(project.id, "project.deleted", { projectId: project.id, actorId: actor.id });
  res.status(204).end();
});

projectRouter.get("/:pid/members", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  const rows = await db.select({ ...publicUserColumns, role: workspaceMembers.role, addedAt: projectMembers.addedAt })
    .from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, project.workspaceId)))
    .where(eq(projectMembers.projectId, project.id)).orderBy(users.name);
  res.json({ items: rows });
});

projectRouter.post("/:pid/members", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "project:members");
  const { userIds } = body(req, z.object({ userIds: z.array(z.uuid()).min(1).max(200) }));
  await assertWorkspaceMembers(project.workspaceId, userIds);
  await db.insert(projectMembers).values(userIds.map((userId) => ({ projectId: project.id, userId }))).onConflictDoNothing();
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "project.members_added", entityType: "project", entityId: project.id,
    summary: `added ${userIds.length} member${userIds.length > 1 ? "s" : ""} to ${project.name}`, metadata: { userIds } });
  broadcast.project(project.id, "project.updated", { projectId: project.id, actorId: actor.id });
  res.status(204).end();
});

projectRouter.delete("/:pid/members/:uid", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "project:members");
  const uid = uuidParam(req, "uid");
  const [r] = await db.delete(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, uid))).returning();
  if (!r) throw notFound("Project member");
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "project.member_removed", entityType: "project", entityId: project.id, summary: `removed a member from ${project.name}`, metadata: { userId: uid } });
  broadcast.project(project.id, "project.updated", { projectId: project.id, actorId: actor.id });
  res.status(204).end();
});

// ─── Labels ──────────────────────────────────────────────────────────────────
projectRouter.get("/:pid/labels", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  res.json({ items: await db.select().from(labels).where(eq(labels.projectId, project.id)).orderBy(labels.name) });
});

const labelInput = z.object({ name: z.string().trim().min(1).max(40), color: color.optional() });

projectRouter.post("/:pid/labels", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"), "label:manage");
  const [label] = await db.insert(labels).values({ ...body(req, labelInput), projectId: project.id }).returning();
  broadcast.project(project.id, "label.changed", { projectId: project.id });
  res.status(201).json(label);
});

async function loadLabel(req: Parameters<typeof uuidParam>[0]) {
  const [label] = await db.select().from(labels).where(eq(labels.id, uuidParam(req, "lid")));
  if (!label) throw notFound("Label");
  await assertProject(me(req), label.projectId, "label:manage");
  return label;
}

labelRouter.patch("/:lid", async (req, res) => {
  const label = await loadLabel(req);
  const [updated] = await db.update(labels).set(body(req, labelInput.partial())).where(eq(labels.id, label.id)).returning();
  broadcast.project(label.projectId, "label.changed", { projectId: label.projectId });
  res.json(updated);
});

labelRouter.delete("/:lid", async (req, res) => {
  const label = await loadLabel(req);
  await db.delete(labels).where(eq(labels.id, label.id));
  broadcast.project(label.projectId, "label.changed", { projectId: label.projectId });
  res.status(204).end();
});
