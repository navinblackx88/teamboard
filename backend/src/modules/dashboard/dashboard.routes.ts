import { Router } from "express";
import { and, asc, eq, exists, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { projectMembers, projects, sprints, taskAssignees, tasks } from "../../db/schema.js";
import { assertWorkspace } from "../../lib/access.js";
import { cache, scopeVersion } from "../../lib/redis.js";
import { uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { hydrate } from "../tasks/task.service.js";

export const dashboardRouter = Router({ mergeParams: true });

/**
 * Everything the dashboard needs in one round trip. Cached in Redis per user, keyed on the
 * workspace's version counter, which every logged activity bumps, so it is never stale.
 */
dashboardRouter.get("/", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const actor = me(req);
  const { role } = await assertWorkspace(actor, wid);
  const key = `dash:${wid}:${actor.id}:${await scopeVersion(`ws:${wid}`)}`;
  res.json(await cache.wrap(key, 300, () => buildDashboard(wid, actor.id, role === "admin" || role === "project_manager")));
});

async function buildDashboard(workspaceId: string, userId: string, seesAll: boolean) {
  const visibleProjects = await db.select().from(projects).where(and(
    eq(projects.workspaceId, workspaceId), eq(projects.status, "active"),
    seesAll ? undefined : exists(db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))),
  )).orderBy(projects.name);
  const pids = visibleProjects.map((p) => p.id);
  if (!pids.length) return { projects: [], myTasks: { total: 0, overdue: 0, byStatus: {}, items: [] }, activeSprints: [], upcomingDeadlines: [] };
  const keys = new Map(visibleProjects.map((p) => [p.id, p.key]));

  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86400_000);
  const assignedToMe = exists(db.select().from(taskAssignees).where(and(eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.userId, userId))));

  const [counts, mineByStatus, myOpen, active, upcoming] = await Promise.all([
    db.select({
      projectId: tasks.projectId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < now())::int`,
    }).from(tasks).where(and(inArray(tasks.projectId, pids), isNull(tasks.parentId))).groupBy(tasks.projectId),
    db.select({ status: tasks.status, n: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueDate} < now())::int` })
      .from(tasks).where(and(inArray(tasks.projectId, pids), assignedToMe)).groupBy(tasks.status),
    db.select().from(tasks).where(and(inArray(tasks.projectId, pids), assignedToMe, ne(tasks.status, "done")))
      .orderBy(sql`coalesce(${tasks.dueDate}, 'infinity'::timestamptz)`, sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`).limit(8),
    db.select({
      sprint: sprints,
      totalTasks: sql<number>`(select count(*)::int from tasks t where t.sprint_id = "sprints"."id")`,
      doneTasks: sql<number>`(select count(*)::int from tasks t where t.sprint_id = "sprints"."id" and t.status = 'done')`,
      totalPoints: sql<number>`(select coalesce(sum(t.story_points),0)::int from tasks t where t.sprint_id = "sprints"."id")`,
      donePoints: sql<number>`(select coalesce(sum(t.story_points),0)::int from tasks t where t.sprint_id = "sprints"."id" and t.status = 'done')`,
    }).from(sprints).where(and(inArray(sprints.projectId, pids), eq(sprints.status, "active"))).orderBy(asc(sprints.endDate)),
    db.select().from(tasks).where(and(inArray(tasks.projectId, pids), ne(tasks.status, "done"), lte(tasks.dueDate, in14)))
      .orderBy(asc(tasks.dueDate)).limit(10),
  ]);

  const byProject = new Map(counts.map((c) => [c.projectId, c]));
  const projectById = new Map(visibleProjects.map((p) => [p.id, p]));

  return {
    projects: visibleProjects.map((p) => {
      const c = byProject.get(p.id) ?? { total: 0, done: 0, overdue: 0 };
      return { id: p.id, name: p.name, key: p.key, color: p.color, total: c.total, done: c.done, overdue: c.overdue,
        progress: c.total ? Math.round((c.done / c.total) * 100) : 0,
        activeSprint: active.find((a) => a.sprint.projectId === p.id)?.sprint.name ?? null };
    }),
    myTasks: {
      total: mineByStatus.reduce((s, r) => s + r.n, 0),
      overdue: mineByStatus.reduce((s, r) => s + r.overdue, 0),
      byStatus: Object.fromEntries(mineByStatus.map((r) => [r.status, r.n])),
      items: await hydrate(myOpen, keys),
    },
    activeSprints: active.map((a) => ({
      ...a.sprint, project: { id: a.sprint.projectId, name: projectById.get(a.sprint.projectId)!.name, key: keys.get(a.sprint.projectId), color: projectById.get(a.sprint.projectId)!.color },
      totalTasks: a.totalTasks, doneTasks: a.doneTasks, totalPoints: a.totalPoints, donePoints: a.donePoints,
      daysLeft: a.sprint.endDate ? Math.ceil((a.sprint.endDate.getTime() - now.getTime()) / 86400_000) : null,
    })),
    upcomingDeadlines: (await hydrate(upcoming, keys)).map((t) => ({ ...t, overdue: Boolean(t.dueDate && t.dueDate < now) })),
  };
}
