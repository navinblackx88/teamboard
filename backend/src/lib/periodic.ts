import { serverless } from "../config/env.js";
import { background } from "./background.js";
import { redis } from "./redis.js";

/**
 * "Lazy cron" for serverless hosts: on incoming traffic, runs a job if it hasn't run in the last `everyMs`.
 * Vercel Cron on the Hobby plan only fires once a day; this keeps time-sensitive jobs (deadline reminders,
 * scoring sweeps) close to their intended cadence whenever the app is in use. A Redis lock makes it run once
 * across instances; without Redis each instance keeps its own clock.
 */
const lastRun = new Map<string, number>();

export async function runIfDue(name: string, everyMs: number, job: () => Promise<unknown>) {
  if (redis) {
    const got = await redis.set(`periodic:${name}`, String(Date.now()), "PX", everyMs, "NX");
    if (!got) return false;
  } else {
    const last = lastRun.get(name) ?? 0;
    if (Date.now() - last < everyMs) return false;
    lastRun.set(name, Date.now());
  }
  background(job(), `periodic ${name}`);
  return true;
}

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };
/** Express middleware: checks due jobs at most once per instance per 30 s, never delaying the request. */
export function lazyCron(jobs: Job[]) {
  let checkedAt = 0;
  return (_req: unknown, _res: unknown, next: () => void) => {
    if (serverless && Date.now() - checkedAt > 30_000) {
      checkedAt = Date.now();
      for (const j of jobs) background(runIfDue(j.name, j.everyMs, j.run), `periodic ${j.name}`);
    }
    next();
  };
}
