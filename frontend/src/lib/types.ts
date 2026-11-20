export type Role = "admin" | "project_manager" | "developer" | "viewer";
export type TaskStatus = "backlog" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type SprintStatus = "planned" | "active" | "completed";
export type Permission =
  | "workspace:update" | "workspace:delete" | "members:manage" | "invites:manage"
  | "project:create" | "project:update" | "project:delete" | "project:members"
  | "sprint:manage" | "label:manage" | "task:create" | "task:update" | "task:delete"
  | "comment:create" | "comment:moderate" | "file:upload" | "file:moderate" | "read";

export const STATUSES: TaskStatus[] = ["backlog", "in_progress", "review", "done"];
export const STATUS_LABEL: Record<TaskStatus, string> = { backlog: "Backlog", in_progress: "In Progress", review: "Review", done: "Done" };
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", project_manager: "Project Manager", developer: "Developer", viewer: "Viewer" };

export interface User { id: string; name: string; email: string; avatarUrl: string | null }
export interface Me extends User { emailNotifications: boolean; hasPassword: boolean; googleLinked: boolean; createdAt: string }
export interface Member extends User { role: Role; joinedAt?: string }
export interface WorkspaceSummary { id: string; name: string; slug: string; role: Role; memberCount?: number }
export interface WorkspaceSettings { defaultRole?: "developer" | "viewer"; allowedEmailDomains?: string[]; timezone?: string }
export interface Workspace extends WorkspaceSummary { ownerId: string; settings: WorkspaceSettings; permissions: Permission[]; createdAt: string }
export interface Invitation { id: string; email: string; role: Role; expiresAt: string; createdAt: string; invitedBy: { id: string; name: string }; inviteUrl?: string }

export interface Label { id: string; name: string; color: string; projectId?: string }
export interface ProjectSettings { defaultSprintLengthDays?: number; wipLimits?: Partial<Record<TaskStatus, number>> }
export interface Project {
  id: string; workspaceId: string; key: string; name: string; description: string | null;
  status: "active" | "archived"; leadId: string | null; color: string; settings: ProjectSettings; createdAt: string;
}
export interface ProjectListItem extends Project {
  memberCount: number;
  stats: { total: number; done: number; inProgress: number; review: number; backlog: number };
  activeSprint: { id: string; name: string; endDate: string | null } | null;
}
export interface ProjectDetail extends Project { members: User[]; labels: Label[]; activeSprint: Sprint | null; role: Role; permissions: Permission[] }

export interface Task {
  id: string; key: string; number: number; projectId: string; title: string; description: string | null;
  status: TaskStatus; priority: Priority; storyPoints: number | null; position: number;
  parentId: string | null; sprintId: string | null; reporterId: string | null;
  dueDate: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
  assignees: User[]; labels: Label[];
  subtaskCount: number; subtaskDoneCount: number; commentCount: number; attachmentCount: number;
}
export interface TaskDetail extends Task {
  subtasks: Task[]; reporter: User | null; parent: { id: string; key: string; title: string } | null;
  sprint: { id: string; name: string; status: SprintStatus } | null;
  project: { id: string; name: string; key: string; workspaceId: string }; canEdit: boolean;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface Board { sprintId: string | null; columns: Record<TaskStatus, Task[]>; wipLimits: Partial<Record<TaskStatus, number>> }

export interface Sprint {
  id: string; projectId: string; name: string; goal: string | null; status: SprintStatus;
  startDate: string | null; endDate: string | null; startedAt: string | null; completedAt: string | null;
  committedPoints: number | null; completedPoints: number | null;
  stats: { totalTasks: number; doneTasks: number; totalPoints: number; donePoints: number };
}
export interface Burndown { committedPoints: number; scopePoints: number; days: { date: string; ideal: number; remaining: number | null; completed: number | null }[] }
export interface Velocity { averageVelocity: number; items: { id: string; name: string; committed: number; completed: number }[] }

export interface Comment {
  id: string; taskId: string; parentId: string | null; body: string; mentionedUserIds: string[];
  author: User | null; editedAt: string | null; deletedAt: string | null; createdAt: string; replies: Comment[];
}
export interface Attachment { id: string; taskId: string; filename: string; mimeType: string; sizeBytes: number; uploader: User | null; createdAt: string }
export type NotificationType = "task_assigned" | "comment_added" | "mentioned" | "deadline_approaching" | "invited" | "sprint_started" | "sprint_completed";
export interface Notification { id: string; type: NotificationType; title: string; body: string | null; link: string | null; workspaceId: string | null; readAt: string | null; createdAt: string }
export interface Activity {
  id: string; action: string; entityType: string; entityId: string | null; summary: string; metadata: Record<string, unknown>;
  actor: User | null; project: { id: string; name: string; key: string; color: string } | null;
  taskId: string | null; taskTitle: string | null; createdAt: string;
}
export interface ActivityPage { items: Activity[]; page: number; pageSize: number; total: number; totalPages: number }

export interface Dashboard {
  projects: { id: string; name: string; key: string; color: string; total: number; done: number; overdue: number; progress: number; activeSprint: string | null }[];
  myTasks: { total: number; overdue: number; byStatus: Partial<Record<TaskStatus, number>>; items: Task[] };
  activeSprints: (Omit<Sprint, "stats"> & { project: { id: string; name: string; key: string; color: string }; totalTasks: number; doneTasks: number; totalPoints: number; donePoints: number; daysLeft: number | null })[];
  upcomingDeadlines: (Task & { overdue: boolean })[];
}
