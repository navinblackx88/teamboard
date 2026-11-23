import "dotenv/config";
import { z } from "zod";

// On Vercel the app and API share one origin; default the URLs from Vercel's system variables.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const defaultOrigin = vercelHost ? `https://${vercelHost}` : undefined;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default(defaultOrigin ?? "http://localhost:5173"), // frontend origin (CORS + email links)
  API_URL: z.string().default(defaultOrigin ?? "http://localhost:4000"),

  DATABASE_URL: z.string().default("postgres://pm:pm@localhost:5432/pm"),
  REDIS_URL: z.string().optional(), // when unset, an in-memory cache is used and Socket.IO runs single-node

  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev-refresh-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(), // MinIO / GCS interoperability endpoint
  S3_PUBLIC_ENDPOINT: z.string().optional(), // endpoint browsers use for presigned URLs, if different (e.g. Docker)
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false", "1", "0"]).default("false").transform((v) => v === "true" || v === "1"),
  MAX_UPLOAD_MB: z.coerce.number().default(25),

  SMTP_HOST: z.string().optional(), // when unset, emails are logged instead of sent
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("TeamBoard <no-reply@teamboard.local>"),

  // Vercel / serverless
  REALTIME_DRIVER: z.enum(["socketio", "pusher"]).default("socketio"), // pusher = Pusher Channels (or any Pusher-protocol server, e.g. soketi)
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().default("mt1"),
  PUSHER_HOST: z.string().optional(), // self-hosted Pusher-compatible server; leave unset for Pusher Channels
  PUSHER_PORT: z.coerce.number().optional(),
  PUSHER_USE_TLS: z.enum(["true", "false", "1", "0"]).default("true").transform((v) => v === "true" || v === "1"),
  DIRECT_UPLOADS: z.enum(["true", "false", "1", "0"]).default("false").transform((v) => v === "true" || v === "1"), // browser → S3 presigned PUT (needed past Vercel's 4.5 MB body limit)
  CRON_SECRET: z.string().optional(), // Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
  DB_POOL_MAX: z.coerce.number().optional(),

  DEADLINE_CHECK_CRON_MINUTES: z.coerce.number().default(15),
  DEADLINE_WINDOW_HOURS: z.coerce.number().default(24),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.treeifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;

if (env.NODE_ENV === "production") {
  const missing = (["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const).filter((k) => env[k].startsWith("dev-"));
  if (missing.length) throw new Error(`Set ${missing.join(" and ")} in production (Vercel: Project → Settings → Environment Variables, then redeploy). Generate one with: openssl rand -base64 48`);
}
/** True inside a Vercel Function (or any serverless host that sets SERVERLESS=1): no long-lived process. */
export const serverless = process.env.VERCEL === "1" || process.env.SERVERLESS === "1";

if (env.REALTIME_DRIVER === "pusher" && !(env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET)) {
  throw new Error("REALTIME_DRIVER=pusher needs PUSHER_APP_ID, PUSHER_KEY and PUSHER_SECRET");
}
if (env.DIRECT_UPLOADS && env.STORAGE_DRIVER !== "s3") throw new Error("DIRECT_UPLOADS needs STORAGE_DRIVER=s3");
if (serverless && env.STORAGE_DRIVER === "local") {
  throw new Error("Local file storage doesn't persist on serverless hosts: set STORAGE_DRIVER=s3 (AWS S3, Cloudflare R2, GCS…)");
}
/** Vercel rejects request bodies over 4.5 MB, so uploads through the API are capped below that. */
export const apiUploadLimitMb = serverless ? Math.min(env.MAX_UPLOAD_MB, 4) : env.MAX_UPLOAD_MB;

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
