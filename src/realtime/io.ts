import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { assertProject, assertWorkspace } from "../lib/access.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";
import { verifyAccessToken } from "../lib/tokens.js";

/**
 * Rooms:
 *   user:{id}       — personal notifications
 *   workspace:{id}  — activity feed, membership changes
 *   project:{id}    — board / sprint / comment updates
 *
 * Server → client events are named "<entity>.<verb>", e.g. task.moved, comment.created.
 */
let io: Server | null = null;

export type RealtimeEvent =
  | "task.created" | "task.updated" | "task.moved" | "task.deleted"
  | "comment.created" | "comment.updated" | "comment.deleted"
  | "attachment.created" | "attachment.deleted"
  | "sprint.created" | "sprint.updated" | "sprint.deleted"
  | "project.updated" | "project.deleted" | "label.changed"
  | "member.changed" | "activity.created" | "notification.created" | "presence.changed";

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.APP_URL, credentials: true }, path: "/socket.io" });

  if (redis) {
    // Pub/sub adapter so events emitted on one API instance reach sockets on every instance.
    io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));
    logger.info("Socket.IO using Redis adapter");
  }

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token ?? String(socket.handshake.query.token ?? "");
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);

    socket.on("workspace:join", async (workspaceId: string, ack?: (r: unknown) => void) => {
      try {
        await assertWorkspace({ id: userId }, workspaceId);
        for (const room of socket.rooms) if (room.startsWith("workspace:")) socket.leave(room);
        socket.join(`workspace:${workspaceId}`);
        ack?.({ ok: true });
      } catch { ack?.({ ok: false }); }
    });

    socket.on("project:join", async (projectId: string, ack?: (r: unknown) => void) => {
      try {
        await assertProject({ id: userId }, projectId);
        socket.join(`project:${projectId}`);
        ack?.({ ok: true });
        void broadcastPresence(projectId);
      } catch { ack?.({ ok: false }); }
    });

    socket.on("project:leave", (projectId: string) => {
      socket.leave(`project:${projectId}`);
      void broadcastPresence(projectId);
    });

    socket.on("disconnecting", () => {
      const projectRooms = [...socket.rooms].filter((r) => r.startsWith("project:"));
      setTimeout(() => projectRooms.forEach((r) => void broadcastPresence(r.slice(8))), 50);
    });
  });
  return io;
}

/** Who is currently viewing a project (works across instances via the adapter). */
async function broadcastPresence(projectId: string) {
  if (!io) return;
  const sockets = await io.in(`project:${projectId}`).fetchSockets();
  const userIds = [...new Set(sockets.map((s) => s.data.userId as string))];
  io.to(`project:${projectId}`).emit("presence.changed", { projectId, userIds });
}

type Payload = Record<string, unknown> & { actorId?: string };
type Scope = "project" | "workspace" | "user";
/** Emits to a Socket.IO room (fanned out across instances by the Redis adapter when REDIS_URL is set). */
function send(scope: Scope, id: string, event: RealtimeEvent, payload: Payload) {
  io?.to(`${scope}:${id}`).emit(event, payload);
}
export const broadcast = {
  project: (id: string, event: RealtimeEvent, payload: Payload) => send("project", id, event, payload),
  workspace: (id: string, event: RealtimeEvent, payload: Payload) => send("workspace", id, event, payload),
  user: (id: string, event: RealtimeEvent, payload: Payload) => send("user", id, event, payload),
};

export const closeRealtime = () => new Promise<void>((r) => (io ? io.close(() => r()) : r()));
