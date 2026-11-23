import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { env, serverless } from "../config/env.js";
import * as schema from "./schema.js";

// Serverless instances each hold their own pool, so keep it small there (point DATABASE_URL at a pooler, e.g. Neon's -pooler host).
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX ?? (serverless ? 5 : 20), idleTimeoutMillis: serverless ? 5_000 : 10_000 });
// On Vercel Fluid compute, release idle connections before an instance is suspended.
if (serverless) attachDatabasePool(pool);
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
