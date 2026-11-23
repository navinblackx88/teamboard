import { Router } from "express";
import { and, count, desc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { activityLogs, projectMembers, projects, tasks, users } from "../../db/schema.js";
import { assertWorkspace } from "../../lib/access.js";
import { query, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";
import { publicUserColumns } from "../users/user.serializer.js";

export const activityRouter = Router({ mergeParams: true });

/** Offset-paginated audit log with filters (page numbers suit an activity table with a total count). */
activityRouter.get("/", async (req, res) => {
  const wid = uuidParam(req, "wid");
  const actor = me(req);
  const { role } = await assertWorkspace(actor, wid);
  const q = query(req, z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    projectId: z.uuid().optional(),
    taskId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    entityType: z.enum(["workspace", "project", "task", "sprint", "comment", "attachment", "member", "label"]).optional(),
    action: z.string().regex(/^[a-z_.]+$/).max(60).optional(), // exact ("task.created") or prefix ending in "." ("task.")
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }));

  // Developers/viewers only see activity from projects they belong to, plus workspace-level events.
  const visible = role === "admin" || role === "project_manager" ? undefined : or(
    isNull(activityLogs.projectId),
    inArray(activityLogs.projectId, db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, actor.id))),
  );
  const where = and(
    eq(activityLogs.workspaceId, wid), visible,
    q.projectId ? eq(activityLogs.projectId, q.projectId) : undefined,
    q.taskId ? eq(activityLogs.taskId, q.taskId) : undefined,
    q.actorId ? eq(activityLogs.actorId, q.actorId) : undefined,
    q.entityType ? eq(activityLogs.entityType, q.entityType) : undefined,
    q.action ? (q.action.endsWith(".") ? like(activityLogs.action, `${q.action}%`) : eq(activityLogs.action, q.action)) : undefined,
    q.from ? gte(activityLogs.createdAt, q.from) : undefined,
    q.to ? lte(activityLogs.createdAt, q.to) : undefined,
  );

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(activityLogs).where(where),
    db.select({
      activity: activityLogs,
      actor: publicUserColumns,
      project: { id: projects.id, name: projects.name, key: projects.key, color: projects.color },
      taskTitle: tasks.title,
    }).from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .leftJoin(projects, eq(projects.id, activityLogs.projectId))
      .leftJoin(tasks, eq(tasks.id, activityLogs.taskId))
      .where(where).orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
  ]);

  res.json({
    items: rows.map((r) => ({
      ...r.activity,
      actor: r.actor?.id ? r.actor : null,
      project: r.project?.id ? r.project : null,
      taskTitle: r.taskTitle,
    })),
    page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  });
});

