// Vercel Function entry: the whole Express API runs as one function (Fluid compute).
// vercel.json rewrites /api/* here; long-running pieces (Socket.IO, timers) are swapped for
// Pusher, Vercel Cron and waitUntil when running on Vercel. See DEPLOY-VERCEL.md.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../backend/src/app.js";

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // The /api/:path* rewrite can arrive as /api?path=v1/...; restore the original URL before Express routes it.
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api" && url.searchParams.has("path")) {
    const path = url.searchParams.get("path") ?? "";
    url.searchParams.delete("path");
    req.url = `/api/${path}${url.search}`;
  }
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
