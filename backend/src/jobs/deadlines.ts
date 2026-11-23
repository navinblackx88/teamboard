import { and, between, eq, inArray, isNull, ne } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { projects, taskAssignees, tasks } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";
import { notify } from "../modules/notifications/notification.service.js";

/**
 * Notifies assignees (or the reporter, if unassigned) when an open task is due within
 * DEADLINE_WINDOW_HOURS. Each task is notified once; changing the due date re-arms it.
 * A Redis lock keeps multiple API instances from sending duplicates.
 */
export async function checkDeadlines(now = new Date()) {
  if (redis) {
    const got = await redis.set("lock:deadline-job", "1", "EX", 60, "NX");
    if (!got) return 0;
  }
  const windowEnd = new Date(now.getTime() + env.DEADLINE_WINDOW_HOURS * 3600_000);
  const due = await db.select({ task: tasks, project: projects }).from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(ne(tasks.status, "done"), isNull(tasks.deadlineNotifiedAt), between(tasks.dueDate, now, windowEnd), eq(projects.status, "active")));
  if (!due.length) return 0;

  const assignees = await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, due.map((d) => d.task.id)));
  for (const { task, project } of due) {
    const recipients = assignees.filter((a) => a.taskId === task.id).map((a) => a.userId);
    if (!recipients.length && task.reporterId) recipients.push(task.reporterId);
    const hours = Math.max(1, Math.round((task.dueDate!.getTime() - now.getTime()) / 3600_000));
    await notify({
      userIds: recipients, type: "deadline_approaching", workspaceId: project.workspaceId,
      title: `${project.key}-${task.number} is due in ${hours} hour${hours === 1 ? "" : "s"}`,
      body: task.title, link: `/projects/${project.id}/board?task=${task.id}`,
      data: { taskId: task.id, dueDate: task.dueDate },
    });
    await db.update(tasks).set({ deadlineNotifiedAt: now }).where(eq(tasks.id, task.id));
  }
  logger.info({ count: due.length }, "deadline notifications sent");
  return due.length;
}

export function startDeadlineJob() {
  const run = () => checkDeadlines().catch((err) => logger.error({ err }, "deadline job failed"));
  const timer = setInterval(run, env.DEADLINE_CHECK_CRON_MINUTES * 60_000);
  timer.unref();
  setTimeout(run, 5_000).unref();
  return () => clearInterval(timer);
}
