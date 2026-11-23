import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { fetchConfig } from "../lib/realtime";
import type {
  ActivityPage, Attachment, Board, Burndown, Comment, Dashboard, Invitation, Me, Member, Notification, Page,
  Permission, Project, ProjectDetail, ProjectListItem, Role, Sprint, Task, TaskDetail, TaskStatus, Velocity, Workspace, WorkspaceSummary,
} from "../lib/types";
import { useUi, toast } from "../stores/ui";

export const qk = {
  me: ["me"] as const,
  workspace: (wid: string) => ["workspace", wid] as const,
  members: (wid: string) => ["members", wid] as const,
  invitations: (wid: string) => ["invitations", wid] as const,
  projects: (wid: string) => ["projects", wid] as const,
  project: (pid: string) => ["project", pid] as const,
  board: (pid: string) => ["board", pid] as const,
  tasks: (pid: string) => ["tasks", pid] as const,
  myTasks: (wid: string) => ["myTasks", wid] as const,
  task: (tid: string) => ["task", tid] as const,
  comments: (tid: string) => ["comments", tid] as const,
  attachments: (tid: string) => ["attachments", tid] as const,
  sprints: (pid: string) => ["sprints", pid] as const,
  burndown: (sid: string) => ["burndown", sid] as const,
  velocity: (pid: string) => ["velocity", pid] as const,
  notifications: ["notifications"] as const,
  unread: ["unread"] as const,
  activity: (wid: string) => ["activity", wid] as const,
  dashboard: (wid: string) => ["dashboard", wid] as const,
};

const onError = (title: string) => (e: unknown) => toast.error(title, errorMessage(e));

// ─── Session / workspace ─────────────────────────────────────────────────────
export const useMe = (enabled = true) =>
  useQuery({ queryKey: qk.me, queryFn: () => api<{ user: Me; workspaces: WorkspaceSummary[] }>("/auth/me"), enabled, staleTime: 60_000 });

export function useCurrentWorkspaceId() {
  return useUi((s) => s.workspaceId);
}

export const useWorkspace = (wid?: string | null) =>
  useQuery({ queryKey: qk.workspace(wid!), queryFn: () => api<Workspace>(`/workspaces/${wid}`), enabled: !!wid });

/** Permission check against the current workspace (or a project, which has the same role). */
export function useCan(perm: Permission, projectPermissions?: Permission[]) {
  const wid = useCurrentWorkspaceId();
  const { data } = useWorkspace(wid);
  return (projectPermissions ?? data?.permissions ?? []).includes(perm);
}

export const useMembers = (wid?: string | null) =>
  useQuery({ queryKey: qk.members(wid!), queryFn: () => api<{ items: Member[] }>(`/workspaces/${wid}/members`).then((r) => r.items), enabled: !!wid, staleTime: 30_000 });

export const useInvitations = (wid: string, enabled: boolean) =>
  useQuery({ queryKey: qk.invitations(wid), queryFn: () => api<{ items: Invitation[] }>(`/workspaces/${wid}/invitations`).then((r) => r.items), enabled });

export function useWorkspaceMutations(wid: string) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.members(wid) }); qc.invalidateQueries({ queryKey: qk.invitations(wid) }); qc.invalidateQueries({ queryKey: qk.workspace(wid) }); qc.invalidateQueries({ queryKey: qk.me }); };
  return {
    update: useMutation({ mutationFn: (body: Partial<Pick<Workspace, "name" | "settings">>) => api(`/workspaces/${wid}`, { method: "PATCH", body }), onSuccess: () => { refresh(); toast.success("Workspace saved"); }, onError: onError("Couldn't save workspace") }),
    invite: useMutation({ mutationFn: (body: { email: string; role: Role }) => api<Invitation>(`/workspaces/${wid}/invitations`, { body }), onSuccess: refresh, onError: onError("Couldn't send invitation") }),
    revoke: useMutation({ mutationFn: (iid: string) => api(`/workspaces/${wid}/invitations/${iid}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't revoke invitation") }),
    setRole: useMutation({ mutationFn: ({ uid, role }: { uid: string; role: Role }) => api(`/workspaces/${wid}/members/${uid}`, { method: "PATCH", body: { role } }), onSuccess: refresh, onError: onError("Couldn't change role") }),
    remove: useMutation({ mutationFn: (uid: string) => api(`/workspaces/${wid}/members/${uid}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't remove member") }),
  };
}

// ─── Projects ────────────────────────────────────────────────────────────────
export const useProjects = (wid?: string | null) =>
  useQuery({ queryKey: qk.projects(wid!), queryFn: () => api<{ items: ProjectListItem[] }>(`/workspaces/${wid}/projects`).then((r) => r.items), enabled: !!wid });

export const useProject = (pid?: string) =>
  useQuery({ queryKey: qk.project(pid!), queryFn: () => api<ProjectDetail>(`/projects/${pid}`), enabled: !!pid });

export function useProjectMutations(pid: string, wid: string) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.project(pid) }); qc.invalidateQueries({ queryKey: qk.projects(wid) }); qc.invalidateQueries({ queryKey: qk.board(pid) }); };
  return {
    update: useMutation({ mutationFn: (body: Partial<Project>) => api<Project>(`/projects/${pid}`, { method: "PATCH", body }), onSuccess: () => { refresh(); toast.success("Project saved"); }, onError: onError("Couldn't save project") }),
    remove: useMutation({ mutationFn: () => api(`/projects/${pid}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(wid) }), onError: onError("Couldn't delete project") }),
    addMembers: useMutation({ mutationFn: (userIds: string[]) => api(`/projects/${pid}/members`, { body: { userIds } }), onSuccess: refresh, onError: onError("Couldn't add members") }),
    removeMember: useMutation({ mutationFn: (uid: string) => api(`/projects/${pid}/members/${uid}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't remove member") }),
    createLabel: useMutation({ mutationFn: (body: { name: string; color: string }) => api(`/projects/${pid}/labels`, { body }), onSuccess: refresh, onError: onError("Couldn't create label") }),
    deleteLabel: useMutation({ mutationFn: (lid: string) => api(`/labels/${lid}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't delete label") }),
  };
}

export function useCreateProject(wid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; key: string; description?: string; color?: string; memberIds?: string[] }) => api<Project>(`/workspaces/${wid}/projects`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects(wid) }),
    onError: onError("Couldn't create project"),
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────
export type BoardFilters = { sprintId: string; assigneeId?: string; labelId?: string; priority?: string; q?: string };

export const useBoard = (pid: string, f: BoardFilters) =>
  useQuery({ queryKey: [...qk.board(pid), f], queryFn: () => api<Board>(`/projects/${pid}/tasks/board`, { query: f }), placeholderData: keepPreviousData });

export type TaskListParams = Record<string, string | undefined>;
export const useTaskList = (pid: string, params: TaskListParams, enabled = true) =>
  useInfiniteQuery({
    queryKey: [...qk.tasks(pid), params],
    queryFn: ({ pageParam }) => api<Page<Task>>(`/projects/${pid}/tasks`, { query: { ...params, limit: 25, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

export const useMyTasks = (wid: string | null, params: TaskListParams) =>
  useInfiniteQuery({
    queryKey: [...qk.myTasks(wid!), params],
    queryFn: ({ pageParam }) => api<Page<Task>>("/me/tasks", { query: { workspaceId: wid!, ...params, limit: 20, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!wid,
  });

export const useTask = (tid?: string | null) =>
  useQuery({ queryKey: qk.task(tid!), queryFn: () => api<TaskDetail>(`/tasks/${tid}`), enabled: !!tid });

/** Everything that might display a task. Cheap to call; React Query only refetches what's mounted. */
export function invalidateTaskViews(qc: QueryClient, pid: string, tid?: string) {
  qc.invalidateQueries({ queryKey: qk.board(pid) });
  qc.invalidateQueries({ queryKey: qk.tasks(pid) });
  qc.invalidateQueries({ queryKey: qk.sprints(pid) });
  qc.invalidateQueries({ queryKey: ["myTasks"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  if (tid) qc.invalidateQueries({ queryKey: qk.task(tid) });
}

export type TaskPatch = Partial<{
  title: string; description: string | null; status: TaskStatus; priority: string; storyPoints: number | null;
  sprintId: string | null; parentId: string | null; assigneeIds: string[]; labelIds: string[]; dueDate: string | null;
}>;

export function useCreateTask(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch & { title: string }) => api<Task>(`/projects/${pid}/tasks`, { body }),
    onSuccess: (t) => invalidateTaskViews(qc, pid, t.parentId ?? undefined),
    onError: onError("Couldn't create task"),
  });
}

export function useUpdateTask(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: TaskPatch & { id: string }) => api<Task>(`/tasks/${id}`, { method: "PATCH", body }),
    onMutate: async ({ id, ...patch }) => {
      // Optimistic for simple fields on the open task.
      const prev = qc.getQueryData<TaskDetail>(qk.task(id));
      const simple = Object.fromEntries(Object.entries(patch).filter(([k]) => !["assigneeIds", "labelIds"].includes(k)));
      if (prev) qc.setQueryData(qk.task(id), { ...prev, ...simple });
      return { prev };
    },
    onError: (e, v, c) => { if (c?.prev) qc.setQueryData(qk.task(v.id), c.prev); onError("Couldn't update task")(e); },
    onSettled: (t, _e, v) => {
      invalidateTaskViews(qc, pid, v.id);
      if (t?.parentId) qc.invalidateQueries({ queryKey: qk.task(t.parentId) });
    },
  });
}

export function useDeleteTask(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateTaskViews(qc, pid),
    onError: onError("Couldn't delete task"),
  });
}

/** Drag-and-drop move with an optimistic board update and rollback on failure. */
export function useMoveTask(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { task: Task; status: TaskStatus; index: number; afterId: string | null; beforeId: string | null }) =>
      api<Task>(`/tasks/${v.task.id}/move`, { body: { status: v.status, afterId: v.afterId, beforeId: v.beforeId } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.board(pid) });
      const snapshots = qc.getQueriesData<Board>({ queryKey: qk.board(pid) });
      qc.setQueriesData<Board>({ queryKey: qk.board(pid) }, (b) => b && placeInBoard(b, { ...v.task, status: v.status }, v.index));
      return { snapshots };
    },
    onError: (e, _v, c) => {
      c?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      onError("Couldn't move task")(e);
    },
    onSettled: (_t, _e, v) => invalidateTaskViews(qc, pid, v.task.id),
  });
}

export function removeFromBoard(b: Board, taskId: string): Board {
  return { ...b, columns: Object.fromEntries(Object.entries(b.columns).map(([s, ts]) => [s, ts.filter((t) => t.id !== taskId)])) as Board["columns"] };
}
/** Insert at an index (local drag) or by position (remote update). */
export function placeInBoard(b: Board, task: Task, index?: number): Board {
  const without = removeFromBoard(b, task.id);
  const col = [...without.columns[task.status]];
  const at = index ?? col.findIndex((t) => t.position > task.position);
  col.splice(at < 0 ? col.length : Math.min(at, col.length), 0, task);
  return { ...without, columns: { ...without.columns, [task.status]: col } };
}

// ─── Sprints ─────────────────────────────────────────────────────────────────
export const useSprints = (pid: string) =>
  useQuery({ queryKey: qk.sprints(pid), queryFn: () => api<{ items: Sprint[] }>(`/projects/${pid}/sprints`).then((r) => r.items) });
export const useBurndown = (sid?: string) =>
  useQuery({ queryKey: qk.burndown(sid!), queryFn: () => api<Burndown>(`/sprints/${sid}/burndown`), enabled: !!sid });
export const useVelocity = (pid: string) =>
  useQuery({ queryKey: qk.velocity(pid), queryFn: () => api<Velocity>(`/projects/${pid}/sprints/velocity`) });

export function useSprintMutations(pid: string) {
  const qc = useQueryClient();
  const refresh = () => { invalidateTaskViews(qc, pid); qc.invalidateQueries({ queryKey: qk.project(pid) }); qc.invalidateQueries({ queryKey: ["burndown"] }); qc.invalidateQueries({ queryKey: qk.velocity(pid) }); };
  return {
    create: useMutation({ mutationFn: (body: { name?: string; goal?: string; startDate?: string | null; endDate?: string | null }) => api<Sprint>(`/projects/${pid}/sprints`, { body }), onSuccess: refresh, onError: onError("Couldn't create sprint") }),
    update: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; goal?: string | null; startDate?: string | null; endDate?: string | null }) => api(`/sprints/${id}`, { method: "PATCH", body }), onSuccess: refresh, onError: onError("Couldn't update sprint") }),
    remove: useMutation({ mutationFn: (id: string) => api(`/sprints/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't delete sprint") }),
    start: useMutation({ mutationFn: ({ id, ...body }: { id: string; startDate?: string; endDate?: string }) => api<Sprint>(`/sprints/${id}/start`, { body }), onSuccess: (s) => { refresh(); toast.success(`${s.name} started`); }, onError: onError("Couldn't start sprint") }),
    complete: useMutation({ mutationFn: ({ id, moveIncompleteTo }: { id: string; moveIncompleteTo: string }) => api<Sprint & { movedCount: number }>(`/sprints/${id}/complete`, { body: { moveIncompleteTo } }), onSuccess: (s) => { refresh(); toast.success(`${s.name} completed`, `${s.completedPoints} points delivered · ${s.movedCount} task(s) carried over`); }, onError: onError("Couldn't complete sprint") }),
    addTasks: useMutation({ mutationFn: ({ id, taskIds }: { id: string; taskIds: string[] }) => api(`/sprints/${id}/tasks`, { body: { taskIds } }), onSuccess: refresh, onError: onError("Couldn't add to sprint") }),
    removeTask: useMutation({ mutationFn: ({ id, taskId }: { id: string; taskId: string }) => api(`/sprints/${id}/tasks/${taskId}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't move to backlog") }),
  };
}

// ─── Comments & files ────────────────────────────────────────────────────────
export const useComments = (tid: string) =>
  useQuery({ queryKey: qk.comments(tid), queryFn: () => api<{ items: Comment[]; total: number }>(`/tasks/${tid}/comments`) });

export function useCommentMutations(tid: string, pid: string) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.comments(tid) }); qc.invalidateQueries({ queryKey: qk.board(pid) }); };
  return {
    create: useMutation({ mutationFn: (body: { body: string; parentId?: string }) => api<Comment>(`/tasks/${tid}/comments`, { body }), onSuccess: refresh, onError: onError("Couldn't post comment") }),
    edit: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => api(`/comments/${id}`, { method: "PATCH", body: { body } }), onSuccess: refresh, onError: onError("Couldn't edit comment") }),
    remove: useMutation({ mutationFn: (id: string) => api(`/comments/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't delete comment") }),
  };
}

export const useAttachments = (tid: string) =>
  useQuery({ queryKey: qk.attachments(tid), queryFn: () => api<{ items: Attachment[] }>(`/tasks/${tid}/attachments`).then((r) => r.items) });

export function useAttachmentMutations(tid: string, pid: string) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.attachments(tid) }); qc.invalidateQueries({ queryKey: qk.board(pid) }); qc.invalidateQueries({ queryKey: qk.task(tid) }); };
  return {
    upload: useMutation({
      mutationFn: async (files: File[]) => {
        const cfg = await qc.fetchQuery({ queryKey: ["config"], queryFn: fetchConfig, staleTime: Infinity });
        const tooBig = files.find((f) => f.size > cfg.uploads.maxMb * 1024 * 1024);
        if (tooBig) throw new Error(`${tooBig.name} is larger than ${cfg.uploads.maxMb} MB`);
        const form = new FormData(); files.forEach((f) => form.append("files", f));
        return api(`/tasks/${tid}/attachments`, { form });
      },
      onSuccess: refresh, onError: onError("Upload failed"),
    }),
    remove: useMutation({ mutationFn: (aid: string) => api(`/attachments/${aid}`, { method: "DELETE" }), onSuccess: refresh, onError: onError("Couldn't delete file") }),
  };
}

export async function openAttachment(aid: string) {
  try {
    const { url } = await api<{ url: string }>(`/attachments/${aid}/url`);
    window.open(url, "_blank", "noopener");
  } catch (e) { toast.error("Couldn't open file", errorMessage(e)); }
}

// ─── Notifications, activity, dashboard ──────────────────────────────────────
export const useUnreadCount = () =>
  useQuery({ queryKey: qk.unread, queryFn: () => api<{ count: number }>("/notifications/unread-count").then((r) => r.count), refetchInterval: 120_000 });

export const useNotifications = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: qk.notifications,
    queryFn: ({ pageParam }) => api<Page<Notification>>("/notifications", { query: { limit: 15, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled,
  });

export function useNotificationMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.notifications }); qc.invalidateQueries({ queryKey: qk.unread }); };
  return {
    read: useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: refresh }),
    readAll: useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: refresh }),
  };
}

export type ActivityFilters = { page: number; pageSize?: number; projectId?: string; actorId?: string; action?: string; entityType?: string; taskId?: string; from?: string; to?: string };
export const useActivity = (wid: string | null, f: ActivityFilters) =>
  useQuery({ queryKey: [...qk.activity(wid!), f], queryFn: () => api<ActivityPage>(`/workspaces/${wid}/activity`, { query: f }), enabled: !!wid, placeholderData: keepPreviousData });

export const useDashboard = (wid: string | null) =>
  useQuery({ queryKey: qk.dashboard(wid!), queryFn: () => api<Dashboard>(`/workspaces/${wid}/dashboard`), enabled: !!wid });
