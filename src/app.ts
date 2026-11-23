import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { redis } from "./lib/redis.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { spa } from "./lib/spa.js";
import { activityRouter } from "./modules/activity/activity.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { commentRouter, taskCommentsRouter } from "./modules/comments/comment.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { attachmentRouter, publicFileRouter, taskAttachmentsRouter } from "./modules/files/file.routes.js";
import { notificationRouter } from "./modules/notifications/notification.routes.js";
import { labelRouter, projectRouter, workspaceProjectsRouter } from "./modules/projects/project.routes.js";
import { projectSprintsRouter, sprintRouter } from "./modules/sprints/sprint.routes.js";
import { myTasksRouter, projectTasksRouter, taskRouter } from "./modules/tasks/task.routes.js";
import { invitationAcceptRouter, invitationPublicRouter, workspaceRouter } from "./modules/workspaces/workspace.routes.js";
import { configRouter } from "./realtime/routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const openapiPath = path.resolve(here, "../openapi.yaml");

/** Route table for /api/v1, kept as data so tests can check it against the OpenAPI spec. */
export const publicMounts: [string, Router][] = [
  ["/auth", authRouter],
  ["/invitations", invitationPublicRouter],
  ["/files", publicFileRouter],
  ["/config", configRouter],
];
export const protectedMounts: [string, Router][] = [
  ["/invitations", invitationAcceptRouter],
  ["/workspaces", workspaceRouter],
  ["/workspaces/:wid/projects", workspaceProjectsRouter],
  ["/workspaces/:wid/activity", activityRouter],
  ["/workspaces/:wid/dashboard", dashboardRouter],
  ["/projects/:pid/tasks", projectTasksRouter],
  ["/projects/:pid/sprints", projectSprintsRouter],
  ["/projects", projectRouter],
  ["/labels", labelRouter],
  ["/tasks/:tid/comments", taskCommentsRouter],
  ["/tasks/:tid/attachments", taskAttachmentsRouter],
  ["/tasks", taskRouter],
  ["/sprints", sprintRouter],
  ["/comments", commentRouter],
  ["/attachments", attachmentRouter],
  ["/notifications", notificationRouter],
  ["/me", myTasksRouter],
];

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  // Single-service deploys: the API also serves the React app (before helmet's API-oriented CSP).
  if (env.STATIC_DIR) app.use(spa(env.STATIC_DIR));
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  if (env.NODE_ENV !== "test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get(["/health", "/api/health"], async (_req, res) => {
    const checks = { db: false, redis: redis ? false : "disabled" as boolean | string };
    try { await pool.query("select 1"); checks.db = true; } catch { /* reported below */ }
    if (redis) try { checks.redis = (await redis.ping()) === "PONG"; } catch { /* reported below */ }
    res.status(checks.db && checks.redis !== false ? 200 : 503).json({ status: checks.db ? "ok" : "degraded", checks });
  });

  // OpenAPI 3.0 docs
  const spec = YAML.parse(fs.readFileSync(openapiPath, "utf8"));
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "TeamBoard API" }));

  const v1 = Router();
  for (const [mount, router] of publicMounts) v1.use(mount, router);
  v1.use(authenticate);
  for (const [mount, router] of protectedMounts) v1.use(mount, router);

  app.use("/api/v1", v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
