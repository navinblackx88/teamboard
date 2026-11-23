import { waitUntil } from "@vercel/functions";
import { logger } from "./logger.js";

/**
 * Fire-and-forget work that must still finish after the response is sent. On Vercel, waitUntil keeps the
 * function alive until the promise settles; elsewhere it's a no-op and the promise simply runs.
 */
export function background(task: Promise<unknown>, label = "background task") {
  const p = task.catch((err) => logger.error({ err }, `${label} failed`));
  waitUntil(p);
  return p;
}
