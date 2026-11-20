import express, { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiUploadLimitMb, env } from "../config/env.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { assertProject, assertWorkspace } from "../lib/access.js";
import { forbidden } from "../lib/errors.js";
import { body } from "../lib/validate.js";
import { me } from "../middleware/auth.js";
import { pusher, pusherClientConfig } from "./pusher.js";

/** Public runtime config for the SPA: which realtime transport to use and how uploads work. */
export const configRouter = Router();
configRouter.get("/", (_req, res) => {
  res.json({
    realtime: env.REALTIME_DRIVER === "pusher" ? { driver: "pusher", pusher: pusherClientConfig() } : { driver: "socketio" },
    uploads: { direct: env.DIRECT_UPLOADS, maxMb: env.DIRECT_UPLOADS ? env.MAX_UPLOAD_MB : apiUploadLimitMb },
  });
});

/**
 * Pusher channel authorization (pusher-js posts socket_id + channel_name, form-encoded).
 * Applies the same checks as the Socket.IO room joins: your own user channel, workspaces you belong to,
 * projects you can read.
 */
export const realtimeRouter = Router();
const authBody = z.object({ socket_id: z.string().regex(/^\d+\.\d+$/), channel_name: z.string().max(200) });

realtimeRouter.post("/auth", express.urlencoded({ extended: false }), async (req, res) => {
  if (env.REALTIME_DRIVER !== "pusher") throw forbidden("Realtime driver is not Pusher");
  const actor = me(req);
  const { socket_id, channel_name } = body(req, authBody);
  const m = /^(private-user|private-workspace|presence-project)-([0-9a-f-]{36})$/.exec(channel_name);
  if (!m) throw forbidden("Unknown channel");
  const [, kind, id] = m;
  if (kind === "private-user" && id !== actor.id) throw forbidden();
  if (kind === "private-workspace") await assertWorkspace(actor, id);
  if (kind === "presence-project") {
    await assertProject(actor, id);
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id));
    return res.json(pusher().authorizeChannel(socket_id, channel_name, { user_id: actor.id, user_info: { name: u?.name ?? "" } }));
  }
  res.json(pusher().authorizeChannel(socket_id, channel_name));
});
