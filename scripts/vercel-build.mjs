// Vercel build: builds the SPA for same-origin API calls, then applies database migrations.
// Migrations use DATABASE_URL_UNPOOLED when present (Neon/Supabase poolers don't support the advisory locks migrators use).
import { execSync } from "node:child_process";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

run("npm run build -w frontend", { VITE_API_URL: "" });

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (url && process.env.SKIP_MIGRATIONS !== "1") run("npm run db:migrate -w backend", { DATABASE_URL: url });
else console.log("Skipping migrations (no DATABASE_URL, or SKIP_MIGRATIONS=1)");
