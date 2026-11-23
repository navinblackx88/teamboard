import type { Role } from "../db/schema.js";

/**
 * Role → permission matrix. Roles are assigned per workspace.
 *   Admin            full control of the workspace
 *   Project Manager  manages projects, sprints, labels and project membership
 *   Developer        works on tasks: create/edit/move, comment, attach files
 *   Viewer           read-only
 */
export const permissions = [
  "workspace:update", "workspace:delete", "members:manage", "invites:manage",
  "project:create", "project:update", "project:delete", "project:members",
  "sprint:manage", "label:manage",
  "task:create", "task:update", "task:delete",
  "comment:create", "comment:moderate",
  "file:upload", "file:moderate",
  "read",
] as const;
export type Permission = (typeof permissions)[number];

const developer: Permission[] = ["read", "task:create", "task:update", "comment:create", "file:upload"];
const projectManager: Permission[] = [
  ...developer, "project:create", "project:update", "project:members", "sprint:manage", "label:manage",
  "task:delete", "comment:moderate", "file:moderate",
];

export const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(permissions),
  project_manager: new Set(projectManager),
  developer: new Set(developer),
  viewer: new Set<Permission>(["read"]),
};

export const can = (role: Role, p: Permission) => rolePermissions[role].has(p);

export const roleRank: Record<Role, number> = { viewer: 0, developer: 1, project_manager: 2, admin: 3 };
