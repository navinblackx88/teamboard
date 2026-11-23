import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { projectMembers, projects, tasks, workspaceMembers, type Project, type Role, type Task } from "../db/schema.js";
import { forbidden, notFound } from "./errors.js";
import { can, type Permission } from "./rbac.js";

type Actor = { id: string };

export async function getRole(userId: string, workspaceId: string): Promise<Role | null> {
  const [m] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return m?.role ?? null;
}

/** Ensures the actor belongs to the workspace and holds the permission. Non-members get 404, not 403. */
export async function assertWorkspace(actor: Actor, workspaceId: string, perm: Permission = "read") {
  const role = await getRole(actor.id, workspaceId);
  if (!role) throw notFound("Workspace");
  if (!can(role, perm)) throw forbidden();
  return { role };
}

/** Admins and project managers see every project in the workspace; others must be project members. */
async function canSeeProject(actorId: string, role: Role, projectId: string) {
  if (role === "admin" || role === "project_manager") return true;
  const [m] = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)));
  return Boolean(m);
}

export async function assertProject(actor: Actor, projectId: string, perm: Permission = "read"): Promise<{ project: Project; role: Role }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw notFound("Project");
  const role = await getRole(actor.id, project.workspaceId);
  if (!role || !(await canSeeProject(actor.id, role, projectId))) throw notFound("Project");
  if (!can(role, perm)) throw forbidden();
  return { project, role };
}

export async function assertTask(actor: Actor, taskId: string, perm: Permission = "read"): Promise<{ task: Task; project: Project; role: Role }> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound("Task");
  const { project, role } = await assertProject(actor, task.projectId, perm).catch((e) => {
    throw e.status === 404 ? notFound("Task") : e;
  });
  return { task, project, role };
}
