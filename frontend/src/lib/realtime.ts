import Pusher, { type PresenceChannel } from "pusher-js";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/stores/auth";
import { api, API_URL, refreshTokens } from "./api";

/** Runtime config served by the API (GET /api/v1/config). */
export type AppConfig = {
  realtime: { driver: "socketio" } | { driver: "pusher"; pusher: { key: string; cluster: string; wsHost?: string; wsPort?: number; wssPort?: number; forceTLS: boolean } };
  uploads: { direct: boolean; maxMb: number };
};
export const fetchConfig = () => api<AppConfig>("/config");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (payload: any) => void;

/**
 * Transport-neutral real-time client. Self-hosted deployments use Socket.IO rooms; on Vercel (no long-lived
 * servers) the API switches to Pusher channels. The hooks only see this interface.
 */
export interface Realtime {
  onStatus(cb: (connected: boolean) => void): () => void;
  joinWorkspace(workspaceId: string): void;
  /** Subscribes to a project's events; `onPresence` receives the ids of everyone viewing it. Returns a leave function. */
  joinProject(projectId: string, onPresence: (userIds: string[]) => void): () => void;
  on(event: string, handler: Handler): () => void;
  close(): void;
}

class SocketIoRealtime implements Realtime {
  private s: Socket;
  private workspaceId: string | null = null;
  constructor() {
    this.s = io(API_URL, { path: "/socket.io", transports: ["websocket", "polling"], auth: (cb) => cb({ token: useAuth.getState().accessToken }) });
    this.s.on("connect_error", async (err) => { if (err.message === "unauthorized" && (await refreshTokens())) this.s.connect(); });
    this.s.on("connect", () => { if (this.workspaceId) this.s.emit("workspace:join", this.workspaceId); });
  }
  onStatus(cb: (c: boolean) => void) {
    const up = () => cb(true), down = () => cb(false);
    cb(this.s.connected);
    this.s.on("connect", up); this.s.on("disconnect", down);
    return () => { this.s.off("connect", up); this.s.off("disconnect", down); };
  }
  joinWorkspace(id: string) {
    this.workspaceId = id;
    if (this.s.connected) this.s.emit("workspace:join", id);
  }
  joinProject(projectId: string, onPresence: (ids: string[]) => void) {
    const join = () => this.s.emit("project:join", projectId);
    const presence = (p: { projectId: string; userIds: string[] }) => p.projectId === projectId && onPresence(p.userIds);
    if (this.s.connected) join();
    this.s.on("connect", join); this.s.on("presence.changed", presence);
    return () => { this.s.off("connect", join); this.s.off("presence.changed", presence); this.s.emit("project:leave", projectId); };
  }
  on(event: string, h: Handler) { this.s.on(event, h); return () => { this.s.off(event, h); }; }
  close() { this.s.disconnect(); }
}

class PusherRealtime implements Realtime {
  private p: Pusher;
  private workspaceChannel: string | null = null;
  constructor(cfg: Extract<AppConfig["realtime"], { driver: "pusher" }>["pusher"], userId: string) {
    this.p = new Pusher(cfg.key, {
      cluster: cfg.cluster,
      ...(cfg.wsHost ? { wsHost: cfg.wsHost, wsPort: cfg.wsPort, wssPort: cfg.wssPort, enabledTransports: ["ws", "wss"] } : {}),
      forceTLS: cfg.forceTLS,
      // Authorize through our API client so expired access tokens are refreshed transparently.
      channelAuthorization: {
        endpoint: "/api/v1/realtime/auth", transport: "ajax",
        customHandler: ({ socketId, channelName }, cb) => {
          api<{ auth: string; channel_data?: string }>("/realtime/auth", { body: { socket_id: socketId, channel_name: channelName } })
            .then((r) => cb(null, r)).catch((e) => cb(e as Error, null));
        },
      },
    });
    this.p.subscribe(`private-user-${userId}`);
  }
  onStatus(cb: (c: boolean) => void) {
    const h = ({ current }: { current: string }) => cb(current === "connected");
    cb(this.p.connection.state === "connected");
    this.p.connection.bind("state_change", h);
    return () => this.p.connection.unbind("state_change", h);
  }
  joinWorkspace(id: string) {
    const name = `private-workspace-${id}`;
    if (this.workspaceChannel === name) return;
    if (this.workspaceChannel) this.p.unsubscribe(this.workspaceChannel);
    this.workspaceChannel = name;
    this.p.subscribe(name);
  }
  joinProject(projectId: string, onPresence: (ids: string[]) => void) {
    const name = `presence-project-${projectId}`;
    const ch = this.p.subscribe(name) as PresenceChannel;
    const emit = () => { const ids: string[] = []; ch.members.each((m: { id: string }) => ids.push(m.id)); onPresence(ids); };
    ch.bind("pusher:subscription_succeeded", emit); ch.bind("pusher:member_added", emit); ch.bind("pusher:member_removed", emit);
    return () => { ch.unbind("pusher:subscription_succeeded", emit); ch.unbind("pusher:member_added", emit); ch.unbind("pusher:member_removed", emit); this.p.unsubscribe(name); };
  }
  /** Pusher#bind listens on every subscribed channel, matching Socket.IO's per-connection handlers. */
  on(event: string, h: Handler) { this.p.bind(event, h); return () => { this.p.unbind(event, h); }; }
  close() { this.p.disconnect(); }
}

let client: { key: string; rt: Realtime } | null = null;

/** One shared connection per signed-in user and transport. */
export function getRealtime(cfg: AppConfig, userId: string): Realtime {
  const key = `${cfg.realtime.driver}:${userId}`;
  if (client?.key === key) return client.rt;
  client?.rt.close();
  const rt = cfg.realtime.driver === "pusher" ? new PusherRealtime(cfg.realtime.pusher, userId) : new SocketIoRealtime();
  client = { key, rt };
  return rt;
}

export function disconnectRealtime() {
  client?.rt.close();
  client = null;
}
