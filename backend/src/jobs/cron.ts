import type { Request, Response } from "express";
import { env, serverless } from "../config/env.js";
import { forbidden, notFound } from "../lib/errors.js";
import { checkDeadlines } from "./deadlines.js";

/** Scheduled jobs, run by Vercel Cron (see vercel.json) or any scheduler that can send an HTTP GET. */
export const cronJobs: Record<string, () => Promise<unknown>> = {
  deadlines: () => checkDeadlines(),
};

export async function cronHandler(req: Request, res: Response) {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Without a secret, cron routes only run outside serverless hosts.
  if (env.CRON_SECRET ? req.headers.authorization !== `Bearer ${env.CRON_SECRET}` : serverless) throw forbidden("Invalid cron secret");
  const job = cronJobs[String(req.params.job)];
  if (!job) throw notFound("Cron job");
  const started = Date.now();
  const result = await job();
  res.json({ job: req.params.job, result, ms: Date.now() - started });
}
