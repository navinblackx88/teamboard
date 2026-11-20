import { and, asc, eq, gt, inArray, isNull, lt, max, sql } from "drizzle-orm";
import { db, type Tx } from "../../db/index.js";
import {
  attachments, comments, labels, projectMembers, projects, sprints, taskAssignees, taskLabels, tasks,
  users, workspaceMembers, type Project, type Task, type TaskStatus,
} from "../../db/schema.js";
import { badRequest } from "../../lib/errors.js";
import { broadcast } from "../../realtime/io.js";
import { logActivity } from "../activity/activity.service.js";
import { notify } from "../notifications/notification.service.js";
import { publicUserColumns, type PublicUser } from "../users/user.serializer.js";

export const STATUS_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", in_progress: "In Progress", review: "Review", done: "Done" };
const GAP = 1024;

export type TaskView = Task & {
  key: string;
  assignees: PublicUser[];
  labels: { id: string; name: string; color: string }[];
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  attachmentCount: number;
};

/** Batch-load assignees, labels and counts for a list of tasks (no N+1). */
export async function hydrate(rows: Task[], projectKeys?: Map<string, string>): Promise<TaskView[]> {
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const keys = projectKeys ?? new Map((await db.select({ id: projects.id, key: projects.key }).from(projects)
    .where(inArray(projects.id, [...new Set(rows.map((r) => r.projectId))]))).map((p) => [p.id, p.key]));

  const [assigneeRows, labelRows, subtaskRows, commentRows, attachmentRows] = await Promise.all([
    db.select({ taskId: taskAssignees.taskId, ...publicUserColumns }).from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId)).where(inArray(taskAssignees.taskId, ids)).orderBy(users.name),
    db.select({ taskId: taskLabels.taskId, id: labels.id, name: labels.name, color: labels.color }).from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId)).where(inArray(taskLabels.taskId, ids)).orderBy(labels.name),
    db.select({ parentId: tasks.parentId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int` })
      .from(tasks).where(inArray(tasks.parentId, ids)).groupBy(tasks.parentId),
    db.select({ taskId: comments.taskId, n: sql<number>`count(*)::int` }).from(comments)
      .where(and(inArray(comments.taskId, ids), isNull(comments.deletedAt))).groupBy(comments.taskId),
    db.select({ taskId: attachments.taskId, n: sql<number>`count(*)::int` }).from(attachments)
      .where(inArray(attachments.taskId, ids)).groupBy(attachments.taskId),
  ]);

  const group = <T extends { taskId: string }>(xs: T[]) => xs.reduce((m, { taskId, ...rest }) => {
    (m.get(taskId) ?? m.set(taskId, []).get(taskId)!).push(rest as Omit<T, "taskId">);
    return m;
  }, new Map<string, Omit<T, "taskId">[]>());
  const a = group(assigneeRows), l = group(labelRows);
  const sub = new Map(subtaskRows.map((s) => [s.parentId!, s]));
  const cc = new Map(commentRows.map((c) => [c.taskId, c.n]));
  const ac = new Map(attachmentRows.map((c) => [c.taskId, c.n]));

  return rows.map((t) => ({
    ...t,
    key: `${keys.get(t.projectId)}-${t.number}`,
    assignees: (a.get(t.id) ?? []) as PublicUser[],
    labels: (l.get(t.id) ?? []) as TaskView["labels"],
    subtaskCount: sub.get(t.id)?.n ?? 0,
    subtaskDoneCount: sub.get(t.id)?.done ?? 0,
    commentCount: cc.get(t.id) ?? 0,
    attachmentCount: ac.get(t.id) ?? 0,
  }));
}

export const hydrateOne = async (t: Task) => (await hydrate([t]))[0];

// ─── Validation of references ────────────────────────────────────────────────
async function checkSprint(projectId: string, sprintId: string | null | undefined) {
  if (!sprintId) return;
  const [s] = await db.select().from(sprints).where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)));
  if (!s) throw badRequest("Sprint does not belong to this project");
  if (s.status === "completed") throw badRequest("Cannot add tasks to a completed sprint");
}

async function checkParent(projectId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest("A task cannot be its own parent");
  const [p] = await db.select().from(tasks).where(eq(tasks.id, parentId));
  if (!p || p.projectId !== projectId) throw badRequest("Parent task must be in the same project");
  if (p.parentId) throw badRequest("Subtasks cannot have their own subtasks");
  if (selfId) {
    const [child] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, selfId)).limit(1);
    if (child) throw badRequest("A task with subtasks cannot become a subtask");
  }
}

async function checkLabels(projectId: string, labelIds: string[] | undefined) {
  if (!labelIds?.length) return;
  const found = await db.select({ id: labels.id }).from(labels).where(and(eq(labels.projectId, projectId), inArray(labels.id, labelIds)));
  if (found.length !== new Set(labelIds).size) throw badRequest("Labels must belong to this project");
}

/** Assignees must be workspace members; developers/viewers are auto-added to the project so they can see it. */
async function prepareAssignees(project: Project, userIds: string[] | undefined, tx: Tx) {
  if (!userIds?.length) return;
  const members = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, project.workspaceId), inArray(workspaceMembers.userId, userIds)));
  if (members.length !== new Set(userIds).size) throw badRequest("Assignees must be members of the workspace");
  await tx.insert(projectMembers).values(userIds.map((userId) => ({ projectId: project.id, userId }))).onConflictDoNothing();
}

async function nextPosition(projectId: string, status: TaskStatus, tx: Tx | typeof db = db) {
  const [r] = await tx.select({ m: max(tasks.position) }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
  return (r?.m ?? 0) + GAP;
}

// ─── Create ──────────────────────────────────────────────────────────────────
export type TaskInput = {
  title: string; description?: string | null; status?: TaskStatus; priority?: Task["priority"];
  storyPoints?: number | null; sprintId?: string | null; parentId?: string | null;
  assigneeIds?: string[]; labelIds?: string[]; dueDate?: Date | null;
};

export async function createTask(project: Project, actorId: string, input: TaskInput) {
  await Promise.all([checkSprint(project.id, input.sprintId), checkParent(project.id, input.parentId), checkLabels(project.id, input.labelIds)]);
  const status = input.status ?? "backlog";

  const task = await db.transaction(async (tx) => {
    // Atomically allocate the next per-project task number (PROJ-123).
    const [{ taskSeq }] = await tx.update(projects).set({ taskSeq: sql`${projects.taskSeq} + 1` })
      .where(eq(projects.id, project.id)).returning({ taskSeq: projects.taskSeq });
    await prepareAssignees(project, input.assigneeIds, tx);
    const [t] = await tx.insert(tasks).values({
      projectId: project.id, number: taskSeq, title: input.title, description: input.description,
      status, priority: input.priority, storyPoints: input.storyPoints, sprintId: input.sprintId,
      parentId: input.parentId, reporterId: actorId, dueDate: input.dueDate,
      position: await nextPosition(project.id, status, tx),
      completedAt: status === "done" ? new Date() : null,
    }).returning();
    if (input.assigneeIds?.length) await tx.insert(taskAssignees).values([...new Set(input.assigneeIds)].map((userId) => ({ taskId: t.id, userId })));
    if (input.labelIds?.length) await tx.insert(taskLabels).values([...new Set(input.labelIds)].map((labelId) => ({ taskId: t.id, labelId })));
    return t;
  });

  const view = await hydrateOne(task);
  await logActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId, action: input.parentId ? "subtask.created" : "task.created",
    entityType: "task", entityId: task.id, summary: `created ${view.key} “${task.title}”` });
  broadcast.project(project.id, "task.created", { task: view, actorId });
  if (input.assigneeIds?.length) await notifyAssigned(project, view, input.assigneeIds, actorId);
  return view;
}

async function notifyAssigned(project: Project, task: TaskView, userIds: string[], actorId: string) {
  const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
  await notify({
    userIds, exclude: actorId, type: "task_assigned", workspaceId: project.workspaceId,
    title: `${actor?.name ?? "Someone"} assigned you ${task.key}`,
    body: `${task.key}: ${task.title}`,
    link: `/projects/${project.id}/board?task=${task.id}`,
    data: { taskId: task.id, projectId: project.id },
  });
}

// ─── Update ──────────────────────────────────────────────────────────────────
const TRACKED: (keyof Task)[] = ["title", "description", "status", "priority", "storyPoints", "sprintId", "parentId", "dueDate"];

export async function updateTask(project: Project, task: Task, actorId: string, input: Partial<TaskInput>) {
  await Promise.all([
    input.sprintId !== undefined ? checkSprint(project.id, input.sprintId) : undefined,
    input.parentId !== undefined ? checkParent(project.id, input.parentId, task.id) : undefined,
    checkLabels(project.id, input.labelIds),
  ]);

  const { assigneeIds, labelIds, ...fields } = input;
  const patch: Partial<Task> = { ...fields };
  if (fields.status && fields.status !== task.status) {
    patch.completedAt = fields.status === "done" ? new Date() : null;
    patch.position = await nextPosition(project.id, fields.status);
  }
  if (fields.dueDate !== undefined && fields.dueDate?.getTime() !== task.dueDate?.getTime()) patch.deadlineNotifiedAt = null;

  let addedAssignees: string[] = [];
  const updated = await db.transaction(async (tx) => {
    const [t] = Object.keys(patch).length
      ? await tx.update(tasks).set(patch).where(eq(tasks.id, task.id)).returning()
      : await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
    if (assigneeIds) {
      const before = (await tx.select({ id: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id))).map((r) => r.id);
      addedAssignees = assigneeIds.filter((id) => !before.includes(id));
      await prepareAssignees(project, assigneeIds, tx);
      await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, task.id));
      if (assigneeIds.length) await tx.insert(taskAssignees).values([...new Set(assigneeIds)].map((userId) => ({ taskId: task.id, userId })));
    }
    if (labelIds) {
      await tx.delete(taskLabels).where(eq(taskLabels.taskId, task.id));
      if (labelIds.length) await tx.insert(taskLabels).values([...new Set(labelIds)].map((labelId) => ({ taskId: task.id, labelId })));
    }
    return t;
  });

  const view = await hydrateOne(updated);
  const changes = TRACKED.filter((k) => k in fields && String(task[k] ?? "") !== String(updated[k] ?? ""))
    .map((k) => ({ field: k, from: task[k], to: updated[k] }));
  if (assigneeIds) changes.push({ field: "assignees" as keyof Task, from: null, to: assigneeIds as never });
  if (labelIds) changes.push({ field: "labels" as keyof Task, from: null, to: labelIds as never });

  if (changes.length) {
    const statusChange = changes.find((c) => c.field === "status");
    await logActivity({
      workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId,
      action: statusChange ? "task.status_changed" : "task.updated", entityType: "task", entityId: task.id,
      summary: statusChange
        ? `moved ${view.key} from ${STATUS_LABEL[task.status]} to ${STATUS_LABEL[updated.status]}`
        : `updated ${changes.map((c) => humanField(c.field)).join(", ")} on ${view.key}`,
      metadata: { changes },
    });
  }
  broadcast.project(project.id, "task.updated", { task: view, actorId });
  if (addedAssignees.length) await notifyAssigned(project, view, addedAssignees, actorId);
  return view;
}

const humanField = (f: string) => ({ storyPoints: "story points", sprintId: "sprint", parentId: "parent", dueDate: "due date" }[f] ?? f);

// ─── Move (drag and drop) ────────────────────────────────────────────────────
/**
 * Places a task in `status`, between `afterId` (the card above) and `beforeId` (the card below).
 * Positions are floats, so a move touches one row; columns are re-spaced only when gaps get tiny.
 */
export async function moveTask(project: Project, task: Task, actorId: string, input: { status: TaskStatus; afterId?: string | null; beforeId?: string | null }) {
  const neighbour = async (id?: string | null) => {
    if (!id) return undefined;
    const [n] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!n || n.projectId !== project.id || n.status !== input.status) throw badRequest("Neighbour task must be in the target column");
    return n.position;
  };
  const [above, below] = await Promise.all([neighbour(input.afterId), neighbour(input.beforeId)]);

  let position: number;
  if (above !== undefined && below !== undefined) position = (above + below) / 2;
  else if (above !== undefined) {
    const [next] = await db.select({ p: tasks.position }).from(tasks)
      .where(and(eq(tasks.projectId, project.id), eq(tasks.status, input.status), gt(tasks.position, above))).orderBy(asc(tasks.position)).limit(1);
    position = next ? (above + next.p) / 2 : above + GAP;
  } else if (below !== undefined) {
    const [prev] = await db.select({ p: tasks.position }).from(tasks)
      .where(and(eq(tasks.projectId, project.id), eq(tasks.status, input.status), lt(tasks.position, below))).orderBy(sql`${tasks.position} desc`).limit(1);
    position = prev ? (prev.p + below) / 2 : below - GAP;
  } else position = await nextPosition(project.id, input.status);

  const statusChanged = input.status !== task.status;
  const [moved] = await db.update(tasks).set({
    status: input.status, position,
    completedAt: statusChanged ? (input.status === "done" ? new Date() : null) : task.completedAt,
  }).where(eq(tasks.id, task.id)).returning();

  if ((above !== undefined && Math.abs(position - above) < 1e-6) || (below !== undefined && Math.abs(below - position) < 1e-6)) {
    await rebalanceColumn(project.id, input.status);
  }

  const view = await hydrateOne((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0] ?? moved);
  if (statusChanged) {
    await logActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId: task.id, actorId, action: "task.status_changed", entityType: "task", entityId: task.id,
      summary: `moved ${view.key} from ${STATUS_LABEL[task.status]} to ${STATUS_LABEL[input.status]}`, metadata: { from: task.status, to: input.status } });
  }
  broadcast.project(project.id, "task.moved", { task: view, fromStatus: task.status, actorId });
  return view;
}

async function rebalanceColumn(projectId: string, status: TaskStatus) {
  await db.execute(sql`
    update tasks t set position = r.rn * ${GAP}
    from (select id, row_number() over (order by position, created_at) as rn from tasks where project_id = ${projectId} and status = ${status}) r
    where t.id = r.id`);
}
