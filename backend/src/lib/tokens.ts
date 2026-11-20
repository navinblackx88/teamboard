import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq, gt, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { refreshTokens } from "../db/schema.js";
import { unauthorized } from "./errors.js";

export type AccessClaims = { sub: string; email: string };

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export function signAccessToken(user: { id: string; email: string }) {
  return jwt.sign({ email: user.email } satisfies Omit<AccessClaims, "sub">, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    return { sub: String(p.sub), email: String(p.email) };
  } catch {
    throw unauthorized("Invalid or expired access token");
  }
}

/** Refresh tokens are opaque random strings; only their hash is stored, and each use rotates them. */
export async function issueRefreshToken(userId: string) {
  const token = randomToken(48);
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86400_000),
  });
  return token;
}

export async function rotateRefreshToken(token: string) {
  const [row] = await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(token)), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
    .returning();
  if (!row) throw unauthorized("Invalid or expired refresh token");
  return { userId: row.userId, refreshToken: await issueRefreshToken(row.userId) };
}

export async function revokeRefreshToken(token: string) {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(token)));
}

export async function issueTokenPair(user: { id: string; email: string }) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id),
    tokenType: "Bearer" as const,
  };
}
