import { Redis } from "ioredis";
import { env, serverless } from "../config/env.js";
import { logger } from "./logger.js";

/** Shared Redis connection, or null when REDIS_URL is not configured (single-node dev). */
export const redis: Redis | null = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }) : null;
redis?.on("error", (e) => logger.error({ err: e }, "redis error"));

/** Minimal TTL cache backed by Redis, falling back to process memory. */
const mem = new Map<string, { v: string; exp: number }>();

export const cache = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = redis ? await redis.get(key) : (() => {
      const hit = mem.get(key);
      if (!hit || hit.exp < Date.now()) { mem.delete(key); return null; }
      return hit.v;
    })();
    return raw ? (JSON.parse(raw) as T) : undefined;
  },
  async set(key: string, value: unknown, ttlSeconds: number) {
    const raw = JSON.stringify(value);
    if (redis) await redis.set(key, raw, "EX", ttlSeconds);
    else mem.set(key, { v: raw, exp: Date.now() + ttlSeconds * 1000 });
  },
  async incr(key: string): Promise<number> {
    if (redis) return redis.incr(key);
    const n = Number(mem.get(key)?.v ?? 0) + 1;
    mem.set(key, { v: String(n), exp: Number.MAX_SAFE_INTEGER });
    return n;
  },
  async raw(key: string): Promise<string | null> {
    return redis ? redis.get(key) : mem.get(key)?.v ?? null;
  },
  /** get-or-compute */
  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    // Serverless instances don't share memory, so a process-local cache would serve stale data after
    // another instance invalidates it. Without Redis there, compute every time.
    if (!redis && serverless) return fn();
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const v = await fn();
    await this.set(key, v, ttlSeconds);
    return v;
  },
};

/**
 * Generation-based invalidation: cache keys embed a per-scope version number,
 * so bumping the version invalidates every key in that scope at once.
 */
export const scopeVersion = async (scope: string) => (await cache.raw(`ver:${scope}`)) ?? "0";
export const invalidateScope = (scope: string) => cache.incr(`ver:${scope}`);
