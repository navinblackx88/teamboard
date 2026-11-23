import path from "node:path";
import fs from "node:fs";
import express, { type RequestHandler } from "express";
import compression from "compression";

/**
 * Serves the built React app from the API process (single-service hosts such as Railway or Render):
 * static files from `dir`, hashed /assets cached forever, and index.html for every other app route.
 * API, health, docs and realtime paths are never touched.
 */
export function spa(dir: string): RequestHandler {
  const index = path.join(dir, "index.html");
  if (!fs.existsSync(index)) throw new Error(`STATIC_DIR has no index.html: ${dir}`);
  const files = express.static(dir, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  const gzip = compression();
  const isAppPath = (p: string) => !p.startsWith("/api") && !p.startsWith("/socket.io") && p !== "/health";
  return (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !isAppPath(req.path)) return next();
    gzip(req, res, () =>
      files(req, res, () => {
        if (req.path.startsWith("/assets/")) return res.status(404).end();
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(index);
      }),
    );
  };
}
