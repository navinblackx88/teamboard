import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, pool } from "./index.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Errors that mean "the database isn't reachable yet" (still starting, DNS not ready), worth retrying. */
const TRANSIENT = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P03"]);
const codeOf = (e: unknown): string | undefined => {
  const err = e as { code?: string; errors?: { code?: string }[] };
  return err.code ?? err.errors?.[0]?.code;
};

/** Waits for Postgres to accept connections (up to ~60 s), so a fresh deploy doesn't crash while the database boots. */
export async function waitForDatabase(attempts = 30, delayMs = 2000) {
  for (let i = 1; ; i++) {
    try { await pool.query("select 1"); return; } catch (e) {
      const code = codeOf(e);
      if (!code || !TRANSIENT.has(code) || i >= attempts) throw e;
      console.warn(`Database not reachable yet (${code}); retrying in ${delayMs / 1000}s [${i}/${attempts}]`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function runMigrations() {
  await waitForDatabase();
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await migrate(db, { migrationsFolder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => { console.log("Migrations applied"); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
