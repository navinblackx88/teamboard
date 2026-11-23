import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { OAuth2Client } from "google-auth-library";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env, googleEnabled } from "../../config/env.js";
import { db } from "../../db/index.js";
import { users, workspaceMembers, workspaces } from "../../db/schema.js";
import { badRequest, HttpError, unauthorized } from "../../lib/errors.js";
import { issueTokenPair, randomToken, signAccessToken, revokeRefreshToken, rotateRefreshToken } from "../../lib/tokens.js";
import { body } from "../../lib/validate.js";
import { authenticate, me } from "../../middleware/auth.js";
import { toSelf } from "../users/user.serializer.js";
import { acceptInvitation } from "../workspaces/invitation.service.js";

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: env.NODE_ENV === "test" ? 10_000 : 30, standardHeaders: "draft-8", legacyHeaders: false });

const email = z.email().max(320).transform((s) => s.trim().toLowerCase());
const password = z.string().min(8, "Password must be at least 8 characters").max(128);

const findByEmail = async (e: string) =>
  (await db.select().from(users).where(sql`lower(${users.email}) = ${e.toLowerCase()}`))[0];

async function authResponse(user: typeof users.$inferSelect, inviteToken?: string) {
  let joinedWorkspaceId: string | undefined;
  if (inviteToken) joinedWorkspaceId = (await acceptInvitation(inviteToken, user)).workspaceId;
  return { user: toSelf(user), ...(await issueTokenPair(user)), joinedWorkspaceId };
}

authRouter.post("/signup", limiter, async (req, res) => {
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120), email, password,
    inviteToken: z.string().optional(),
  }));
  if (await findByEmail(input.email)) throw new HttpError(409, "email_taken", "An account with this email already exists");
  const [user] = await db.insert(users).values({
    name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12),
  }).returning();
  res.status(201).json(await authResponse(user, input.inviteToken));
});

authRouter.post("/login", limiter, async (req, res) => {
  const input = body(req, z.object({ email, password: z.string().min(1), inviteToken: z.string().optional() }));
  const user = await findByEmail(input.email);
  // Compare against a dummy hash when the user is missing so response timing doesn't reveal accounts.
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5Lr6X7S0VWuXg0n9g0k2Q3lFJz7WkXy");
  if (!user || !user.passwordHash || !ok) throw unauthorized("Invalid email or password");
  res.json(await authResponse(user, input.inviteToken));
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = body(req, z.object({ refreshToken: z.string().min(1) }));
  const rotated = await rotateRefreshToken(refreshToken);
  const [user] = await db.select().from(users).where(eq(users.id, rotated.userId));
  if (!user) throw unauthorized();
  res.json({ accessToken: signAccessToken(user), refreshToken: rotated.refreshToken, tokenType: "Bearer" });
});

authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = body(req, z.object({ refreshToken: z.string().min(1) }));
  await revokeRefreshToken(refreshToken);
  res.status(204).end();
});

authRouter.get("/me", authenticate, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, me(req).id));
  if (!user) throw unauthorized();
  const memberships = await db.select({
    id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role,
  }).from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id)).orderBy(workspaces.name);
  res.json({ user: toSelf(user), workspaces: memberships });
});

authRouter.patch("/me", authenticate, async (req, res) => {
  const input = body(req, z.object({
    name: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.url().max(2000).nullable().optional(),
    emailNotifications: z.boolean().optional(),
    currentPassword: z.string().optional(),
    newPassword: password.optional(),
  }));
  const [user] = await db.select().from(users).where(eq(users.id, me(req).id));
  const patch: Partial<typeof users.$inferInsert> = {
    name: input.name, avatarUrl: input.avatarUrl, emailNotifications: input.emailNotifications,
  };
  if (input.newPassword) {
    if (user.passwordHash && !(await bcrypt.compare(input.currentPassword ?? "", user.passwordHash))) {
      throw badRequest("Current password is incorrect");
    }
    patch.passwordHash = await bcrypt.hash(input.newPassword, 12);
  }
  const [updated] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
  res.json({ user: toSelf(updated) });
});

// ─── Google OAuth2 ───────────────────────────────────────────────────────────
const redirectUri = `${env.API_URL}/api/v1/auth/google/callback`;
const google = () => {
  if (!googleEnabled) throw new HttpError(501, "google_disabled", "Google sign-in is not configured on this server");
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
};

authRouter.get("/providers", (_req, res) => res.json({ google: googleEnabled }));

/** Step 1 (redirect flow): send the browser to Google's consent screen. */
authRouter.get("/google", (req, res) => {
  const inviteToken = typeof req.query.inviteToken === "string" ? req.query.inviteToken : undefined;
  const state = jwt.sign({ n: randomToken(8), inviteToken }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
  res.redirect(google().generateAuthUrl({ scope: ["openid", "email", "profile"], state, prompt: "select_account" }));
});

/** Step 2: Google redirects back; tokens are handed to the SPA in the URL fragment (never sent to servers or logs). */
authRouter.get("/google/callback", async (req, res) => {
  const fail = (msg: string) => res.redirect(`${env.APP_URL}/auth/callback#error=${encodeURIComponent(msg)}`);
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const { inviteToken } = jwt.verify(state, env.JWT_ACCESS_SECRET) as { inviteToken?: string };
    const client = google();
    const { tokens } = await client.getToken(code);
    const result = await signInWithGoogleIdToken(client, tokens.id_token!, inviteToken);
    const frag = new URLSearchParams({ access: result.accessToken, refresh: result.refreshToken });
    if (result.joinedWorkspaceId) frag.set("workspace", result.joinedWorkspaceId);
    res.redirect(`${env.APP_URL}/auth/callback#${frag}`);
  } catch (e) {
    fail(e instanceof HttpError ? e.message : "Google sign-in failed");
  }
});

/** Alternative: the SPA obtains an ID token via Google Identity Services and posts it here. */
authRouter.post("/google", limiter, async (req, res) => {
  const input = body(req, z.object({ idToken: z.string().min(10), inviteToken: z.string().optional() }));
  res.json(await signInWithGoogleIdToken(google(), input.idToken, input.inviteToken));
});

async function signInWithGoogleIdToken(client: OAuth2Client, idToken: string, inviteToken?: string) {
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw unauthorized("Google account email is not verified");

  let [user] = await db.select().from(users).where(eq(users.googleId, p.sub));
  if (!user) {
    const existing = await findByEmail(p.email);
    if (existing) {
      // Link the Google identity to the existing email account (Google verified ownership).
      [user] = await db.update(users).set({ googleId: p.sub, avatarUrl: existing.avatarUrl ?? p.picture })
        .where(eq(users.id, existing.id)).returning();
    } else {
      [user] = await db.insert(users).values({
        email: p.email.toLowerCase(), name: p.name ?? p.email.split("@")[0], googleId: p.sub, avatarUrl: p.picture,
      }).returning();
    }
  }
  return authResponse(user, inviteToken);
}
