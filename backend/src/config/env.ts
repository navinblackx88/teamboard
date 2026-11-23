import "dotenv/config";
import { z } from "zod";

// On Railway the app and API share one origin; default the URLs from the service's generated public domain.
const publicHost = process.env.RAILWAY_PUBLIC_DOMAIN;
const defaultOrigin = publicHost ? `https://${publicHost}` : undefined;

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
  STATIC_DIR: z.string().optional(), // built frontend to serve from the API (the Railway image sets this)
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(), // MinIO / GCS interoperability endpoint
  S3_PUBLIC_ENDPOINT: z.string().optional(), // endpoint browsers use for presigned download URLs, if different
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false", "1", "0"]).default("false").transform((v) => v === "true" || v === "1"),
  MAX_UPLOAD_MB: z.coerce.number().default(25),

  SMTP_HOST: z.string().optional(), // when unset, emails are logged instead of sent
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("TeamBoard <no-reply@teamboard.local>"),

  DB_POOL_MAX: z.coerce.number().default(20),

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
  if (missing.length) throw new Error(`Set ${missing.join(" and ")} in production (Railway: service → Variables). Generate one with: openssl rand -base64 48`);
}
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
