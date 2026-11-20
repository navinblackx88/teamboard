import Pusher from "pusher";
import { env } from "../config/env.js";
import { background } from "../lib/background.js";

/**
 * Pusher Channels driver, used on Vercel where functions can't hold WebSocket connections.
 * Works with Pusher Channels or any Pusher-protocol server (soketi, Ably's Pusher adapter) via PUSHER_HOST.
 *
 * Channel names mirror the Socket.IO rooms:
 *   private-user-{id}, private-workspace-{id}, presence-project-{id}
 * Presence channels give the "who's viewing" list natively, so no server-side presence tracking is needed.
 */
let client: Pusher | null = null;
export function pusher() {
  client ??= new Pusher({
    appId: env.PUSHER_APP_ID!, key: env.PUSHER_KEY!, secret: env.PUSHER_SECRET!, cluster: env.PUSHER_CLUSTER,
    ...(env.PUSHER_HOST ? { host: env.PUSHER_HOST, port: String(env.PUSHER_PORT ?? (env.PUSHER_USE_TLS ? 443 : 80)) } : {}),
    useTLS: env.PUSHER_USE_TLS,
  });
  return client;
}

export const channelFor = { user: (id: string) => `private-user-${id}`, workspace: (id: string) => `private-workspace-${id}`, project: (id: string) => `presence-project-${id}` };

/** Pusher caps a message at 10 KB. Oversized payloads are trimmed to ids; clients refetch on any event anyway. */
const MAX_BYTES = 9_000;
function fit(payload: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(payload)) <= MAX_BYTES) return payload;
  const slim: Record<string, unknown> = { truncated: true };
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) slim[k] = v;
    else if (v && typeof v === "object" && "id" in v) slim[`${k}Id`] = (v as { id: unknown }).id;
  }
  return slim;
}

export function trigger(channel: string, event: string, payload: Record<string, unknown>) {
  background(pusher().trigger(channel, event, fit(payload)), `pusher ${event}`);
}

/** Public client settings, served from /api/v1/config so the frontend needs no build-time keys. */
export function pusherClientConfig() {
  return {
    key: env.PUSHER_KEY!, cluster: env.PUSHER_CLUSTER,
    ...(env.PUSHER_HOST ? { wsHost: env.PUSHER_HOST, wsPort: env.PUSHER_PORT, wssPort: env.PUSHER_PORT } : {}),
    forceTLS: env.PUSHER_USE_TLS,
  };
}

