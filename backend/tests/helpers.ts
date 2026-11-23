import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { redis } from "../src/lib/redis.js";
import { closeRealtime, initRealtime } from "../src/realtime/io.js";

export type Ctx = { server: http.Server; url: string; api: ReturnType<typeof request> };

export async function startServer(): Promise<Ctx> {
  await runMigrations();
  const tables = (await pool.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => `"${r.tablename}"`);
  await pool.query(`truncate ${tables.join(", ")} cascade`);
  await redis?.flushdb();
  const server = http.createServer(createApp());
  initRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, api: request(server) };
}

export async function stopServer(ctx: Ctx) {
  await closeRealtime();
  await new Promise((r) => ctx.server.close(r));
}

let n = 0;
export type TestUser = { id: string; email: string; name: string; token: string; refresh: string };

export async function signup(ctx: Ctx, name: string, inviteToken?: string, email?: string): Promise<TestUser> {
  const addr = email ?? `${name.toLowerCase().replace(/\s+/g, ".")}.${++n}@example.com`;
  const res = await ctx.api.post("/api/v1/auth/signup").send({ name, email: addr, password: "password123", inviteToken });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.user.id, email: addr, name, token: res.body.accessToken, refresh: res.body.refreshToken };
}

/** Authenticated request helper: as(user).get("/path") */
export const as = (ctx: Ctx, user: TestUser) => {
  const auth = <T extends request.Test>(t: T) => t.set("Authorization", `Bearer ${user.token}`);
  const p = (path: string) => `/api/v1${path}`;
  return {
    get: (path: string) => auth(ctx.api.get(p(path))),
    post: (path: string, body?: object) => auth(ctx.api.post(p(path))).send(body ?? {}),
    patch: (path: string, body?: object) => auth(ctx.api.patch(p(path))).send(body ?? {}),
    delete: (path: string) => auth(ctx.api.delete(p(path))),
    upload: (path: string) => auth(ctx.api.post(p(path))),
  };
};

/** Invite by email and accept with a fresh account. */
export async function addMember(ctx: Ctx, admin: TestUser, workspaceId: string, name: string, role: string) {
  const email = `${name.toLowerCase()}.${++n}@example.com`;
  const inv = await as(ctx, admin).post(`/workspaces/${workspaceId}/invitations`, { email, role });
  if (inv.status !== 201) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`);
  const token = new URL(inv.body.inviteUrl).pathname.split("/").pop()!;
  return signup(ctx, name, token, email);
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
