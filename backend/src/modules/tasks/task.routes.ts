import { Router, type Request } from "express";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  priorityEnum, projects, sprints, taskAssignees, taskLabels, tasks, taskStatusEnum, users,
} from "../../db/schema.js";
import { assertProject, assertTask, assertWorkspace } from "../../lib/access.js";
import { forbidden } from "../../lib/errors.js";
import { decodeCursor, pageOf } from "../../lib/pagination.js";
import { can } from "../../lib/rbac.js";
import { body, csv, limitParam, query, qbool, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { publicUserColumns } from "../users/user.serializer.js";
import { createTask, hydrate, hydrateOne, moveTask, updateTask } from "./task.service.js";

export const projectTasksRouter = Router({ mergeParams: true });
export const taskRouter = Router();
export const myTasksRouter = Router();

const status = z.enum(taskStatusEnum.enumValues);
const priority = z.enum(priorityEnum.enumValues);
const isoDate = z.coerce.date();

const taskFields = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(50_000).nullable(),
  status, priority,
  storyPoints: z.number().int().min(0).max(100).nullable(),
  sprintId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  assigneeIds: z.array(z.uuid()).max(20),
  labelIds: z.array(z.uuid()).max(20),
  dueDate: isoDate.nullable(),
};
const createSchema = z.object(taskFields).partial().required({ title: true });
const updateSchema = z.object(taskFields).partial();

// ─── Listing with keyset pagination ──────────────────────────────────────────
const SORTS = {
  position: { expr: sql`${tasks.position}`, cast: "double precision", dir: "asc" },
  created: { expr: sql`${tasks.createdAt}`, cast: "timestamptz", dir: "desc" },
  updated: { expr: sql`${tasks.updatedAt}`, cast: "timestamptz", dir: "desc" },
  due: { expr: sql`coalesce(${tasks.dueDate}, 'infinity'::timestamptz)`, cast: "timestamptz", dir: "asc" },
} as const;

const listQuery = z.object({
  status: csv(status),
  priority: csv(priority),
  labelId: csv(z.uuid()),
  assigneeId: z.union([z.uuid(), z.literal("me"), z.literal("unassigned")]).optional(),
  sprintId: z.union([z.uuid(), z.literal("backlog"), z.literal("active")]).optional(),
  parentId: z.uuid().optional(),
  includeSubtasks: qbool,
  dueBefore: isoDate.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default("position"),
  limit: limitParam(30),
  cursor: z.string().optional(),
});
type ListQuery = z.infer<typeof listQuery>;

async function listTasks(scope: SQL, q: ListQuery, actorId: string) {
  const sort = SORTS[q.sort];
  const cursor = decodeCursor(q.cursor);
  const cmp = sort.dir === "asc" ? sql`>` : sql`<`;
  const keyMatch = q.q?.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/); // "PM-12"

  const where = and(
    scope,
    q.status?.length ? inArray(tasks.status, q.status) : undefined,
    q.priority?.length ? inArray(tasks.priority, q.priority) : undefined,
    q.parentId ? eq(tasks.parentId, q.parentId) : q.includeSubtasks ? undefined : isNull(tasks.parentId),
    q.sprintId === "backlog" ? isNull(tasks.sprintId)
      : q.sprintId === "active" ? inArray(tasks.sprintId, db.select({ id: sprints.id }).from(sprints).where(eq(sprints.status, "active")))
      : q.sprintId ? eq(tasks.sprintId, q.sprintId) : undefined,
    q.assigneeId === "unassigned"
      ? sql`not exists (select 1 from task_assignees a where a.task_id = "tasks"."id")`
      : q.assigneeId ? exists(db.select().from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, q.assigneeId === "me" ? actorId : q.assigneeId)))) : undefined,
    q.labelId?.length ? exists(db.select().from(taskLabels).where(and(eq(taskLabels.taskId, tasks.id), inArray(taskLabels.labelId, q.labelId)))) : undefined,
    q.dueBefore ? sql`${tasks.dueDate} <= ${q.dueBefore}` : undefined,
    q.q ? or(ilike(tasks.title, `%${q.q}%`), keyMatch
      ? and(eq(tasks.number, Number(keyMatch[2])), sql`exists (select 1 from projects p where p.id = "tasks"."project_id" and upper(p.key) = ${keyMatch[1].toUpperCase()})`)
      : undefined) : undefined,
    cursor ? sql`(${sort.expr}, ${tasks.id}) ${cmp} (${cursor.v}::${sql.raw(sort.cast)}, ${cursor.id}::uuid)` : undefined,
  );

  const rows = await db.select({ task: tasks, sortKey: sql<string>`(${sort.expr})::text` }).from(tasks).where(where)
    .orderBy(sort.dir === "asc" ? asc(sort.expr) : desc(sort.expr), sort.dir === "asc" ? asc(tasks.id) : desc(tasks.id))
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, (r) => ({ v: r.sortKey, id: r.task.id }));
  return { items: await hydrate(page.items.map((r) => r.task)), nextCursor: page.nextCursor };
}

projectTasksRouter.get("/", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  res.json(await listTasks(eq(tasks.projectId, project.id), query(req, listQuery), me(req).id));
});

/** All top-level tasks for the board, grouped by column. */
projectTasksRouter.get("/board", async (req, res) => {
  const { project } = await assertProject(me(req), uuidParam(req, "pid"));
  const q = query(req, z.object({
    sprintId: z.union([z.uuid(), z.literal("active"), z.literal("all")]).default("all"),
    assigneeId: z.uuid().optional(), labelId: z.uuid().optional(), priority: priority.optional(), q: z.string().trim().max(200).optional(),
  }));
  let sprintId: string | null | undefined;
  if (q.sprintId === "active") {
    const [s] = await db.select({ id: sprints.id }).from(sprints).where(and(eq(sprints.projectId, project.id), eq(sprints.status, "active")));
    sprintId = s?.id ?? null;
  } else if (q.sprintId !== "all") sprintId = q.sprintId;

  const rows = await db.select().from(tasks).where(and(
    eq(tasks.projectId, project.id), isNull(tasks.parentId),
    sprintId === null ? sql`false` : sprintId ? eq(tasks.sprintId, sprintId)
      // "all": hide work already closed out in completed sprints
      : sql`(${tasks.sprintId} is null or ${tasks.sprintId} not in (select id from sprints where status = 'completed'))`,
    q.assigneeId ? exists(db.select().from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, q.assigneeId)))) : undefined,
    q.labelId ? exists(db.select().from(taskLabels).where(and(eq(taskLabels.taskId, tasks.id), eq(taskLabels.labelId, q.labelId)))) : undefined,
    q.priority ? eq(tasks.priority, q.priority) : undefined,
    q.q ? ilike(tasks.title, `%${q.q}%`) : undefined,
  )).orderBy(asc(tasks.position));
  const views = await hydrate(rows, new Map([[project.id, project.key]]));
  const columns = Object.fromEntries(taskStatusEnum.enumValues.map((s) => [s, views.filter((t) => t.status === s)]));
  res.json({ sprintId: sprintId ?? null, columns, wipLimits: project.settings.wipLimits ?? {} });
});

projectTasksRouter.post("/", async (req, res) => {
  const actor = me(req);
  const { project } = await assertProject(actor, uuidParam(req, "pid"), "task:create");
  res.status(201).json(await createTask(project, actor.id, body(req, createSchema)));
});

// ─── My tasks (dashboard + infinite scroll) ──────────────────────────────────
myTasksRouter.get("/tasks", async (req, res) => {
  const actor = me(req);
  const q = query(req, listQuery.extend({ workspaceId: z.uuid(), sort: listQuery.shape.sort.unwrap().default("due") }));
  await assertWorkspace(actor, q.workspaceId);
  const scope = and(
    inArray(tasks.projectId, db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, q.workspaceId), eq(projects.status, "active")))),
    exists(db.select().from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, actor.id)))),
  )!;
  res.json(await listTasks(scope, { ...q, includeSubtasks: q.includeSubtasks ?? true }, actor.id));
});

// ─── Single task ─────────────────────────────────────────────────────────────
taskRouter.get("/:tid", async (req, res) => {
  const { task, project, role } = await assertTask(me(req), uuidParam(req, "tid"));
  const [view] = await hydrate([task], new Map([[project.id, project.key]]));
  const [subtasks, [reporter], [parent], [sprint]] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.parentId, task.id)).orderBy(asc(tasks.createdAt)).then((r) => hydrate(r, new Map([[project.id, project.key]]))),
    task.reporterId ? db.select(publicUserColumns).from(users).where(eq(users.id, task.reporterId)) : Promise.resolve([]),
    task.parentId ? db.select({ id: tasks.id, number: tasks.number, title: tasks.title }).from(tasks).where(eq(tasks.id, task.parentId)) : Promise.resolve([]),
    task.sprintId ? db.select({ id: sprints.id, name: sprints.name, status: sprints.status }).from(sprints).where(eq(sprints.id, task.sprintId)) : Promise.resolve([]),
  ]);
  res.json({
    ...view, subtasks, reporter: reporter ?? null, sprint: sprint ?? null,
    parent: parent ? { ...parent, key: `${project.key}-${parent.number}` } : null,
    project: { id: project.id, name: project.name, key: project.key, workspaceId: project.workspaceId },
    canEdit: can(role, "task:update"),
  });
});

taskRouter.get("/:tid/subtasks", async (req, res) => {
  const { task, project } = await assertTask(me(req), uuidParam(req, "tid"));
  const rows = await db.select().from(tasks).where(eq(tasks.parentId, task.id)).orderBy(asc(tasks.createdAt));
  res.json({ items: await hydrate(rows, new Map([[project.id, project.key]])) });
});

taskRouter.patch("/:tid", async (req, res) => {
  const actor = me(req);
  const { task, project } = await assertTask(actor, uuidParam(req, "tid"), "task:update");
  res.json(await updateTask(project, task, actor.id, body(req, updateSchema)));
});

taskRouter.post("/:tid/move", async (req, res) => {
  const actor = me(req);
  const { task, project } = await assertTask(actor, uuidParam(req, "tid"), "task:update");
  const input = body(req, z.object({ status, afterId: z.uuid().nullable().optional(), beforeId: z.uuid().nullable().optional() }));
  res.json(await moveTask(project, task, actor.id, input));
});

taskRouter.delete("/:tid", async (req: Request, res) => {
  const actor = me(req);
  const { task, project, role } = await assertTask(actor, uuidParam(req, "tid"), "task:update");
  // Managers can delete anything; developers only tasks they reported.
  if (!can(role, "task:delete") && task.reporterId !== actor.id) throw forbidden("Only the reporter or a project manager can delete this task");
  const view = await hydrateOne(task);
  await db.delete(tasks).where(eq(tasks.id, task.id));
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, actorId: actor.id, action: "task.deleted", entityType: "task", entityId: task.id,
    summary: `deleted ${view.key} “${task.title}”` });
  broadcast.project(project.id, "task.deleted", { taskId: task.id, parentId: task.parentId, actorId: actor.id });
  res.status(204).end();
});

