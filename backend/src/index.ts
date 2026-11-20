import http from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { startDeadlineJob } from "./jobs/deadlines.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { closeRealtime, initRealtime } from "./realtime/io.js";

await runMigrations();
const server = http.createServer(createApp());
initRealtime(server);
const stopJob = startDeadlineJob();

server.listen(env.PORT, () => {
  logger.info(`API on ${env.API_URL}  ·  docs ${env.API_URL}/api/docs  ·  redis ${redis ? "on" : "off (in-memory)"}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal}: shutting down`);
  stopJob();
  await closeRealtime();
  server.close();
  await pool.end();
  redis?.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
