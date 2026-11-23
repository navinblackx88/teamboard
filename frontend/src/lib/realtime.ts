import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/stores/auth";
import { api, API_URL, refreshTokens } from "./api";

/** Runtime config served by the API (GET /api/v1/config). */
export type AppConfig = { uploads: { maxMb: number } };
export const fetchConfig = () => api<AppConfig>("/config");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (payload: any) => void;

/** Real-time client over Socket.IO rooms. The hooks only see this interface. */
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

let client: { key: string; rt: Realtime } | null = null;

/** One shared connection per signed-in user. */
export function getRealtime(_cfg: AppConfig, userId: string): Realtime {
  const key = userId;
  if (client?.key === key) return client.rt;
  client?.rt.close();
  const rt = new SocketIoRealtime();
  client = { key, rt };
  return rt;
}

export function disconnectRealtime() {
  client?.rt.close();
  client = null;
}
