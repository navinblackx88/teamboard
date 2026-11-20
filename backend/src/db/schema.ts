import { relations, sql } from "drizzle-orm";
import {
  boolean, doublePrecision, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date());

export const roleEnum = pgEnum("workspace_role", ["admin", "project_manager", "developer", "viewer"]);
export const taskStatusEnum = pgEnum("task_status", ["backlog", "in_progress", "review", "done"]);
export const priorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const sprintStatusEnum = pgEnum("sprint_status", ["planned", "active", "completed"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived"]);

// ─── Auth ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: id(),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  passwordHash: text("password_hash"),
  googleId: varchar("google_id", { length: 64 }),
  avatarUrl: text("avatar_url"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
  uniqueIndex("users_google_uq").on(t.googleId),
]);

export const refreshTokens = pgTable("refresh_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("refresh_hash_uq").on(t.tokenHash), index("refresh_user_idx").on(t.userId)]);

// ─── Workspaces ──────────────────────────────────────────────────────────────
export const workspaces = pgTable("workspaces", {
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("workspaces_slug_uq").on(t.slug)]);

export type WorkspaceSettings = {
  defaultRole?: "developer" | "viewer";
  allowedEmailDomains?: string[];
  timezone?: string;
};

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("developer"),
  joinedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("wm_user_idx").on(t.userId)]);

export const invitations = pgTable("invitations", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: roleEnum("role").notNull().default("developer"),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  invitedById: uuid("invited_by_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_ws_idx").on(t.workspaceId)]);

// ─── Projects ────────────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 10 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("active"),
  leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
  color: varchar("color", { length: 9 }).notNull().default("#6366f1"),
  taskSeq: integer("task_seq").notNull().default(0),
  settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("projects_ws_key_uq").on(t.workspaceId, t.key)]);

export type ProjectSettings = { defaultSprintLengthDays?: number; wipLimits?: Partial<Record<TaskStatus, number>> };

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  addedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("pm_user_idx").on(t.userId)]);

export const labels = pgTable("labels", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 40 }).notNull(),
  color: varchar("color", { length: 9 }).notNull().default("#64748b"),
}, (t) => [uniqueIndex("labels_project_name_uq").on(t.projectId, t.name)]);

// ─── Sprints ─────────────────────────────────────────────────────────────────
export const sprints = pgTable("sprints", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  goal: text("goal"),
  status: sprintStatusEnum("status").notNull().default("planned"),
  startDate: ts("start_date"),
  endDate: ts("end_date"),
  startedAt: ts("started_at"),
  completedAt: ts("completed_at"),
  committedPoints: integer("committed_points"), // frozen at start
  completedPoints: integer("completed_points"), // frozen at completion
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("sprints_project_idx").on(t.projectId, t.status)]);

// ─── Tasks ───────────────────────────────────────────────────────────────────
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

export const tasks = pgTable("tasks", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("backlog"),
  priority: priorityEnum("priority").notNull().default("medium"),
  storyPoints: integer("story_points"),
  position: doublePrecision("position").notNull().default(0), // fractional ordering within a column
  parentId: uuid("parent_id"),
  sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
  reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: ts("due_date"),
  completedAt: ts("completed_at"),
  deadlineNotifiedAt: ts("deadline_notified_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("tasks_project_number_uq").on(t.projectId, t.number),
  index("tasks_board_idx").on(t.projectId, t.status, t.position),
  index("tasks_sprint_idx").on(t.sprintId),
  index("tasks_parent_idx").on(t.parentId),
  index("tasks_due_idx").on(t.dueDate),
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "tasks_parent_fk" }).onDelete("cascade"),
]);

export const taskAssignees = pgTable("task_assignees", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("ta_user_idx").on(t.userId)]);

export const taskLabels = pgTable("task_labels", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.taskId, t.labelId] })]);

// ─── Comments & files ────────────────────────────────────────────────────────
export const comments = pgTable("comments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  parentId: uuid("parent_id"),
  body: text("body").notNull(),
  mentionedUserIds: uuid("mentioned_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  index("comments_task_idx").on(t.taskId, t.createdAt),
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "comments_parent_fk" }).onDelete("cascade"),
]);

export const attachments = pgTable("attachments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 150 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: createdAt(),
}, (t) => [index("attachments_task_idx").on(t.taskId)]);

// ─── Notifications & activity ────────────────────────────────────────────────
export const notificationTypes = ["task_assigned", "comment_added", "mentioned", "deadline_approaching", "invited", "sprint_started", "sprint_completed"] as const;
export type NotificationType = (typeof notificationTypes)[number];

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 40 }).$type<NotificationType>().notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  body: text("body"),
  link: text("link"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  readAt: ts("read_at"),
  createdAt: createdAt(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const activityLogs = pgTable("activity_logs", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 60 }).notNull(), // e.g. task.created, task.moved, sprint.started
  entityType: varchar("entity_type", { length: 30 }).notNull(),
  entityId: uuid("entity_id"),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  index("activity_ws_idx").on(t.workspaceId, t.createdAt),
  index("activity_project_idx").on(t.projectId, t.createdAt),
  index("activity_task_idx").on(t.taskId),
]);

// ─── Relations (for relational queries) ──────────────────────────────────────
export const tasksRelations = relations(tasks, ({ many, one }) => ({
  assignees: many(taskAssignees),
  labels: many(taskLabels),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
}));
export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, { fields: [taskAssignees.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskAssignees.userId], references: [users.id] }),
}));
export const taskLabelsRelations = relations(taskLabels, ({ one }) => ({
  task: one(tasks, { fields: [taskLabels.taskId], references: [tasks.id] }),
  label: one(labels, { fields: [taskLabels.labelId], references: [labels.id] }),
}));
export const projectsRelations = relations(projects, ({ many }) => ({ tasks: many(tasks) }));

export type Role = (typeof roleEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Sprint = typeof sprints.$inferSelect;
