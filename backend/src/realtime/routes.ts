import { Router } from "express";
import { env } from "../config/env.js";

/** Public runtime config for the SPA. */
export const configRouter = Router();
configRouter.get("/", (_req, res) => {
  res.json({ uploads: { maxMb: env.MAX_UPLOAD_MB } });
});
