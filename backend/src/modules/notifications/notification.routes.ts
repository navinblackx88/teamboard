import { Router } from "express";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { notFound } from "../../lib/errors.js";
import { decodeCursor, pageOf } from "../../lib/pagination.js";
import { limitParam, qbool, query, uuidParam } from "../../lib/validate.js";
import { me } from "../../middleware/auth.js";

export const notificationRouter = Router();

notificationRouter.get("/", async (req, res) => {
  const user = me(req);
  const q = query(req, z.object({ unreadOnly: qbool, workspaceId: z.uuid().optional(), limit: limitParam(20, 50), cursor: z.string().optional() }));
  const cursor = decodeCursor(q.cursor);
  const rows = await db.select({ n: notifications, k: sql<string>`${notifications.createdAt}::text` }).from(notifications).where(and(
    eq(notifications.userId, user.id),
    q.unreadOnly ? isNull(notifications.readAt) : undefined,
    q.workspaceId ? eq(notifications.workspaceId, q.workspaceId) : undefined,
    cursor ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.v}::timestamptz, ${cursor.id}::uuid)` : undefined,
  )).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(q.limit + 1);
  const page = pageOf(rows, q.limit, (r) => ({ v: r.k, id: r.n.id }));
  res.json({ items: page.items.map((r) => r.n), nextCursor: page.nextCursor });
});

notificationRouter.get("/unread-count", async (req, res) => {
  const [{ n }] = await db.select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, me(req).id), isNull(notifications.readAt)));
  res.json({ count: n });
});

notificationRouter.post("/read-all", async (req, res) => {
  const r = await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me(req).id), isNull(notifications.readAt))).returning({ id: notifications.id });
  res.json({ updated: r.length });
});

notificationRouter.post("/:nid/read", async (req, res) => {
  const [n] = await db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, uuidParam(req, "nid")), eq(notifications.userId, me(req).id))).returning();
  if (!n) throw notFound("Notification");
  res.json(n);
});
