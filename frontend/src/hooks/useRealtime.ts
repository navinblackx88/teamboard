import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchConfig, getRealtime, type Realtime } from "../lib/realtime";
import type { Board, Comment, Notification, Task } from "../lib/types";
import { toast } from "../stores/ui";
import { invalidateTaskViews, placeInBoard, qk, removeFromBoard, useMe } from "./queries";

type WithActor = { actorId?: string };

export const useAppConfig = () => useQuery({ queryKey: ["config"], queryFn: fetchConfig, staleTime: Infinity });

/** The shared real-time client, once runtime config and the signed-in user are known. */
function useRealtimeClient(): Realtime | null {
  const { data: cfg } = useAppConfig();
  const userId = useMe().data?.user.id;
  return cfg && userId ? getRealtime(cfg, userId) : null;
}

/** Workspace-wide: activity feed, notifications, membership. Mounted once in the app shell. */
export function useWorkspaceRealtime(workspaceId: string | null) {
  const qc = useQueryClient();
  const rt = useRealtimeClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!workspaceId || !rt) return;
    rt.joinWorkspace(workspaceId);
    const offStatus = rt.onStatus(setConnected);

    const onActivity = () => {
      qc.invalidateQueries({ queryKey: qk.activity(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.dashboard(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.projects(workspaceId) });
    };
    const onNotification = ({ notification: n }: { notification: Notification }) => {
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: qk.unread });
      toast.info(n.title, n.body ?? undefined, n.link ?? undefined);
    };
    const onMember = () => {
      qc.invalidateQueries({ queryKey: qk.members(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.workspace(workspaceId) });
      qc.invalidateQueries({ queryKey: qk.me });
    };
    const offs = [rt.on("activity.created", onActivity), rt.on("notification.created", onNotification), rt.on("member.changed", onMember)];
    return () => { offStatus(); offs.forEach((off) => off()); };
  }, [workspaceId, rt, qc]);
  return connected;
}

/**
 * Project room: board, sprint, comment and file updates from teammates.
 * Board caches are patched in place for an instant update, then refetched in the background
 * so active filters stay correct. Our own echoes are ignored (they're already applied optimistically).
 */
export function useProjectRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  const myId = useMe().data?.user.id;
  const rt = useRealtimeClient();
  const [viewers, setViewers] = useState<string[]>([]);

  useEffect(() => {
    if (!projectId || !rt) return;
    const leave = rt.joinProject(projectId, setViewers);

    const mine = (p: WithActor) => p.actorId && p.actorId === myId;
    const patchBoards = (fn: (b: Board) => Board) => qc.setQueriesData<Board>({ queryKey: qk.board(projectId) }, (b) => b && fn(b));

    const onTask = (p: WithActor & { task?: Task; taskId?: string }) => {
      if (mine(p)) return;
      // Large payloads may arrive trimmed to ids (Pusher's 10 KB limit); then we just refetch.
      if (!p.task) { invalidateTaskViews(qc, projectId, p.taskId); return; }
      if (!p.task.parentId) patchBoards((b) => placeInBoard(b, p.task!));
      invalidateTaskViews(qc, projectId, p.task.id);
      if (p.task.parentId) qc.invalidateQueries({ queryKey: qk.task(p.task.parentId) });
    };
    const onDeleted = (p: WithActor & { taskId: string; parentId?: string | null }) => {
      if (mine(p)) return;
      patchBoards((b) => removeFromBoard(b, p.taskId));
      invalidateTaskViews(qc, projectId);
      qc.removeQueries({ queryKey: qk.task(p.taskId) });
      if (p.parentId) qc.invalidateQueries({ queryKey: qk.task(p.parentId) });
    };
    const onComment = (p: WithActor & { taskId: string; comment?: Comment }) => {
      qc.invalidateQueries({ queryKey: qk.comments(p.taskId) });
      qc.invalidateQueries({ queryKey: qk.board(projectId) });
    };
    const onAttachment = (p: WithActor & { taskId: string }) => {
      qc.invalidateQueries({ queryKey: qk.attachments(p.taskId) });
      qc.invalidateQueries({ queryKey: qk.task(p.taskId) });
      qc.invalidateQueries({ queryKey: qk.board(projectId) });
    };
    const onSprint = () => {
      invalidateTaskViews(qc, projectId);
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      qc.invalidateQueries({ queryKey: ["burndown"] });
      qc.invalidateQueries({ queryKey: qk.velocity(projectId) });
    };
    const onProject = () => { qc.invalidateQueries({ queryKey: qk.project(projectId) }); qc.invalidateQueries({ queryKey: qk.board(projectId) }); };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: [string, (...a: any[]) => void][] = [
      ["task.created", onTask], ["task.updated", onTask], ["task.moved", onTask], ["task.deleted", onDeleted],
      ["comment.created", onComment], ["comment.updated", onComment], ["comment.deleted", onComment],
      ["attachment.created", onAttachment], ["attachment.deleted", onAttachment],
      ["sprint.created", onSprint], ["sprint.updated", onSprint], ["sprint.deleted", onSprint],
      ["project.updated", onProject], ["label.changed", onProject],
    ];
    const offs = handlers.map(([e, h]) => rt.on(e, h));
    return () => { offs.forEach((off) => off()); leave(); setViewers([]); };
  }, [projectId, rt, myId, qc]);

  return viewers;
}
