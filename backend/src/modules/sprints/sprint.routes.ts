import { Router, type Request } from "express";
import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { projectMembers, sprints, sprintStatusEnum, tasks, type Sprint } from "../../db/schema.js";
import { assertProject } from "../../lib/access.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { body, query, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { notify } from "../notifications/notification.service.js";

export const projectSprintsRouter = Router({ mergeParams: true });
export const sprintRouter = Router();

const DAY = 86400_000;
const isoDate = z.coerce.date();

/** Points per sprint: total, done, and task counts (top-level and subtasks both count). */
const statsFor = async (sprintIds: string[]) => {
  if (!sprintIds.length) return new Map<string, SprintStats>();
  const rows = await db.select({
    sprintId: tasks.sprintId,
    totalTasks: sql<number>`count(*)::int`,
    doneTasks: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    totalPoints: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)::int`,
    donePoints: sql<number>`coalesce(sum(${tasks.storyPoints}) filter (where ${tasks.status} = 'done'), 0)::int`,
  }).from(tasks).where(inArray(tasks.sprintId, sprintIds)).groupBy(tasks.sprintId);
  return new Map(rows.map(({ sprintId, ...s }) => [sprintId!, s]));
};
type SprintStats = { totalTasks: number; doneTasks: number; totalPoints: number; donePoints: number };
const emptyStats: SprintStats = { totalTasks: 0, doneTasks: 0, totalPoints: 0, donePoints: 0 };

async function withStats(rows: Sprint[]) {
  const stats = await statsFor(rows.map((s) => s.id));
  return rows.map((s) => ({ ...s, stats: stats.get(s.id) ?? emptyStats }));
}

async function loadSprint(req: Request, perm: "read" | "sprint:manage" = "read") {
  const [sprint] = await db.select().from(sprints).where(eq(sprints.id, uuidParam(req, "sid")));
  if (!sprint) throw notFound("Sprint");
  const { project } = await assertProject(me(req), sprint.projectId, perm);
  return { sprint, project };
}

const dates = { startDate: isoDate.nullable(), endDate: isoDate.nullable() };
const checkDates = (s?: Date | null, e?: Date | null) => {
  if (s && e && e <= s) throw badRequest("End date must be after start date");
};

projectSprintsRouter.get("/", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  const { status } = query(req, z.object({ status: z.enum(sprintStatusEnum.enumValues).optional() }));
  const rows = await db.select().from(sprints)
    .where(and(eq(sprints.projectId, project.id), status ? eq(sprints.status, status) : undefined))
    // active first, then planned (soonest first), then completed (latest first)
    .orderBy(sql`case ${sprints.status} when 'active' then 0 when 'planned' then 1 else 2 end`,
      sql`case when ${sprints.status} = 'completed' then extract(epoch from ${sprints.completedAt}) * -1 else extract(epoch from coalesce(${sprints.startDate}, ${sprints.createdAt})) end`);
  res.json({ items: await withStats(rows) });
});

projectSprintsRouter.post("/", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "sprint:manage");
  const input = body(req, z.object({ name: z.string().trim().min(1).max(120).optional(), goal: z.string().max(2000).optional(), ...dates }).partial());
  checkDates(input.startDate, input.endDate);
  const [{ n }] = await db.select({ n: count() }).from(sprints).where(eq(sprints.projectId, project.id));
  const len = project.settings.defaultSprintLengthDays ?? 14;
  const startDate = input.startDate ?? null;
  const [sprint] = await db.insert(sprints).values({
    projectId: project.id, name: input.name ?? `${project.key} Sprint ${n + 1}`, goal: input.goal,
    startDate, endDate: input.endDate ?? (startDate ? new Date(startDate.getTime() + len * DAY) : null),
  }).returning();
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "sprint.created", entityType: "sprint", entityId: sprint.id, summary: `created ${sprint.name}` });
  broadcast.project(project.id, "sprint.created", { sprint, actorId: actor.id });
  res.status(201).json({ ...sprint, stats: emptyStats });
});

sprintRouter.get("/:sid", async (req, res) => {
  const { sprint } = await loadSprint(req);
  res.json((await withStats([sprint]))[0]);
});

sprintRouter.patch("/:sid", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  if (sprint.status === "completed") throw badRequest("Completed sprints cannot be edited");
  const input = body(req, z.object({ name: z.string().trim().min(1).max(120), goal: z.string().max(2000).nullable(), ...dates }).partial());
  checkDates(input.startDate ?? sprint.startDate, input.endDate ?? sprint.endDate);
  const [updated] = await db.update(sprints).set(input).where(eq(sprints.id, sprint.id)).returning();
  broadcast.project(project.id, "sprint.updated", { sprint: updated, actorId: actor.id });
  res.json((await withStats([updated]))[0]);
});

sprintRouter.delete("/:sid", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  if (sprint.status !== "planned") throw badRequest("Only planned sprints can be deleted; complete active sprints instead");
  await db.delete(sprints).where(eq(sprints.id, sprint.id)); // tasks fall back to the backlog (FK set null)
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "sprint.deleted", entityType: "sprint", entityId: sprint.id, summary: `deleted ${sprint.name}` });
  broadcast.project(project.id, "sprint.deleted", { sprintId: sprint.id, actorId: actor.id });
  res.status(204).end();
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────
sprintRouter.post("/:sid/start", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  if (sprint.status !== "planned") throw badRequest(`Sprint is already ${sprint.status}`);
  const input = body(req, z.object(dates).partial());
  const startDate = input.startDate ?? sprint.startDate ?? new Date();
  const endDate = input.endDate ?? sprint.endDate ?? new Date(startDate.getTime() + (project.settings.defaultSprintLengthDays ?? 14) * DAY);
  checkDates(startDate, endDate);

  const started = await db.transaction(async (tx) => {
    const [active] = await tx.select({ name: sprints.name }).from(sprints)
      .where(and(eq(sprints.projectId, project.id), eq(sprints.status, "active"))).for("update");
    if (active) throw conflict(`${active.name} is still active. Complete it before starting another sprint.`);
    const [{ pts }] = await tx.select({ pts: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)::int` }).from(tasks).where(eq(tasks.sprintId, sprint.id));
    const [s] = await tx.update(sprints).set({ status: "active", startDate, endDate, startedAt: new Date(), committedPoints: pts })
      .where(eq(sprints.id, sprint.id)).returning();
    return s;
  });

  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "sprint.started", entityType: "sprint", entityId: sprint.id,
    summary: `started ${sprint.name} with ${started.committedPoints} points committed`, metadata: { committedPoints: started.committedPoints } });
  const members = await db.select({ id: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id));
  await notify({ userIds: members.map((m) => m.id), exclude: actor.id, type: "sprint_started", workspaceId: project.workspaceId,
    title: `${sprint.name} has started in ${project.name}`, body: sprint.goal ?? undefined, link: `/projects/${project.id}/board`, email: false });
  broadcast.project(project.id, "sprint.updated", { sprint: started, actorId: actor.id });
  res.json((await withStats([started]))[0]);
});

sprintRouter.post("/:sid/complete", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  if (sprint.status !== "active") throw badRequest("Only an active sprint can be completed");
  const { moveIncompleteTo } = body(req, z.object({ moveIncompleteTo: z.union([z.literal("backlog"), z.uuid()]).default("backlog") }));
  if (moveIncompleteTo !== "backlog") {
    const [target] = await db.select().from(sprints).where(and(eq(sprints.id, moveIncompleteTo), eq(sprints.projectId, project.id)));
    if (!target || target.status !== "planned") throw badRequest("Incomplete tasks can only move to the backlog or a planned sprint in this project");
  }

  const result = await db.transaction(async (tx) => {
    const [{ pts }] = await tx.select({ pts: sql<number>`coalesce(sum(${tasks.storyPoints}) filter (where ${tasks.status} = 'done'), 0)::int` })
      .from(tasks).where(eq(tasks.sprintId, sprint.id));
    const moved = await tx.update(tasks).set({ sprintId: moveIncompleteTo === "backlog" ? null : moveIncompleteTo })
      .where(and(eq(tasks.sprintId, sprint.id), sql`${tasks.status} <> 'done'`)).returning({ id: tasks.id });
    const [s] = await tx.update(sprints).set({ status: "completed", completedAt: new Date(), completedPoints: pts })
      .where(eq(sprints.id, sprint.id)).returning();
    return { sprint: s, movedCount: moved.length };
  });

  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "sprint.completed", entityType: "sprint", entityId: sprint.id,
    summary: `completed ${sprint.name}: ${result.sprint.completedPoints}/${sprint.committedPoints ?? 0} points done, ${result.movedCount} unfinished task(s) moved to ${moveIncompleteTo === "backlog" ? "the backlog" : "the next sprint"}`,
    metadata: { completedPoints: result.sprint.completedPoints, committedPoints: sprint.committedPoints, movedCount: result.movedCount } });
  const members = await db.select({ id: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id));
  await notify({ userIds: members.map((m) => m.id), exclude: actor.id, type: "sprint_completed", workspaceId: project.workspaceId,
    title: `${sprint.name} completed in ${project.name}`, body: `${result.sprint.completedPoints} of ${sprint.committedPoints ?? 0} committed points delivered`,
    link: `/projects/${project.id}/sprints`, email: false });
  broadcast.project(project.id, "sprint.updated", { sprint: result.sprint, actorId: actor.id });
  res.json({ ...(await withStats([result.sprint]))[0], movedCount: result.movedCount });
});

// ─── Planning: add/remove tasks ──────────────────────────────────────────────
sprintRouter.post("/:sid/tasks", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  if (sprint.status === "completed") throw badRequest("Cannot add tasks to a completed sprint");
  const { taskIds } = body(req, z.object({ taskIds: z.array(z.uuid()).min(1).max(200) }));
  const updated = await db.update(tasks).set({ sprintId: sprint.id })
    .where(and(inArray(tasks.id, taskIds), eq(tasks.projectId, project.id))).returning({ id: tasks.id });
  if (updated.length !== taskIds.length) throw badRequest("Some tasks were not found in this project");
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "sprint.tasks_added", entityType: "sprint", entityId: sprint.id,
    summary: `added ${taskIds.length} task${taskIds.length > 1 ? "s" : ""} to ${sprint.name}`, metadata: { taskIds } });
  broadcast.project(project.id, "sprint.updated", { sprintId: sprint.id, taskIds, actorId: actor.id });
  res.json((await withStats([sprint]))[0]);
});

sprintRouter.delete("/:sid/tasks/:tid", async (req, res) => {
  const actor = me(req);
  const { sprint, project } = await loadSprint(req, "sprint:manage");
  const tid = uuidParam(req, "tid");
  const [t] = await db.update(tasks).set({ sprintId: null }).where(and(eq(tasks.id, tid), eq(tasks.sprintId, sprint.id))).returning({ id: tasks.id });
  if (!t) throw notFound("Task in this sprint");
  broadcast.project(project.id, "sprint.updated", { sprintId: sprint.id, taskIds: [tid], actorId: actor.id });
  res.status(204).end();
});

// ─── Reports ─────────────────────────────────────────────────────────────────
/**
 * Burndown: one point per day from start to end (or today, for active sprints).
 *   ideal      straight line from committed points to 0
 *   remaining  current scope minus points of tasks completed by end of that day (null for future days)
 * Scope added after start shows up as remaining > committed.
 */
sprintRouter.get("/:sid/burndown", async (req, res) => {
  const { sprint } = await loadSprint(req);
  if (!sprint.startDate || !sprint.endDate || sprint.status === "planned") {
    res.json({ sprint, committedPoints: 0, scopePoints: 0, days: [] });
    return;
  }
  const sprintTasks = await db.select({ points: tasks.storyPoints, completedAt: tasks.completedAt, status: tasks.status })
    .from(tasks).where(eq(tasks.sprintId, sprint.id));
  const scope = sprint.status === "completed"
    ? Math.max(sprint.committedPoints ?? 0, sprintTasks.reduce((s, t) => s + (t.points ?? 0), 0))
    : sprintTasks.reduce((s, t) => s + (t.points ?? 0), 0);
  const committed = sprint.committedPoints ?? scope;

  const start = startOfDayUTC(sprint.startDate);
  const end = startOfDayUTC(sprint.endDate);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
  const cutoff = sprint.status === "completed" ? (sprint.completedAt ?? new Date()) : new Date();

  const days = [];
  for (let i = 0; i <= totalDays; i++) {
    const day = new Date(start.getTime() + i * DAY);
    const dayEnd = new Date(day.getTime() + DAY);
    const isFuture = day > cutoff;
    const done = sprintTasks.filter((t) => t.status === "done" && t.completedAt && t.completedAt < dayEnd).reduce((s, t) => s + (t.points ?? 0), 0);
    days.push({
      date: day.toISOString().slice(0, 10),
      ideal: Math.round((committed - (committed * i) / totalDays) * 10) / 10,
      remaining: isFuture ? null : scope - done,
      completed: isFuture ? null : done,
    });
  }
  res.json({ sprint, committedPoints: committed, scopePoints: scope, days });
});

projectSprintsRouter.get("/velocity", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  const { limit } = query(req, z.object({ limit: z.coerce.number().int().min(1).max(24).default(6) }));
  const rows = await db.select({
    id: sprints.id, name: sprints.name, committed: sprints.committedPoints, completed: sprints.completedPoints,
    startDate: sprints.startDate, completedAt: sprints.completedAt,
  }).from(sprints).where(and(eq(sprints.projectId, project.id), eq(sprints.status, "completed"), isNotNull(sprints.completedAt)))
    .orderBy(desc(sprints.completedAt)).limit(limit);
  const items = rows.reverse().map((r) => ({ ...r, committed: r.committed ?? 0, completed: r.completed ?? 0 }));
  const avg = items.length ? Math.round((items.reduce((s, r) => s + r.completed, 0) / items.length) * 10) / 10 : 0;
  res.json({ items, averageVelocity: avg });
});

const startOfDayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
