import { useAuth } from "../stores/auth";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

// One in-flight refresh shared by every request that hits a 401.
let refreshing: Promise<boolean> | null = null;
export function refreshTokens(): Promise<boolean> {
  const { refreshToken, setTokens, clear } = useAuth.getState();
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }),
  }).then(async (r) => {
    if (!r.ok) { clear(); return false; }
    const body = await r.json();
    setTokens(body.accessToken, body.refreshToken);
    return true;
  }).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; form?: FormData; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const url = new URL(BASE + path, window.location.origin); // BASE is relative when the API shares the app's origin (Vercel)
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const token = useAuth.getState().accessToken;
  const res = await fetch(url, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  });
  if (res.status === 401 && retry && useAuth.getState().refreshToken && !path.startsWith("/auth/")) {
    if (await refreshTokens()) return api<T>(path, opts, false);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? res.statusText, data?.error?.code, data?.error?.details);
  }
  return data as T;
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? e.details?.length ? `${e.message}: ${e.details.map((d) => `${d.path || "value"} ${d.message.toLowerCase()}`).join("; ")}` : e.message
    : e instanceof Error ? e.message : "Something went wrong";
