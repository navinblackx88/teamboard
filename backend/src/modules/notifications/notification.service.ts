import { inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { notifications, users, type NotificationType } from "../../db/schema.js";
import { sendEmail } from "../../lib/mailer.js";
import { broadcast } from "../../realtime/io.js";

export type NotifyInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  workspaceId?: string;
  data?: Record<string, unknown>;
  /** Usually the actor: people are not notified about their own actions. */
  exclude?: string | null;
  email?: boolean;
};

/** Creates in-app notifications, pushes them over WebSocket, and emails opted-in users. */
export async function notify(input: NotifyInput) {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.exclude);
  if (!recipients.length) return [];

  const rows = await db.insert(notifications).values(recipients.map((userId) => ({
    userId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
    workspaceId: input.workspaceId,
    data: input.data ?? {},
  }))).returning();

  for (const n of rows) broadcast.user(n.userId, "notification.created", { notification: n });

  if (input.email !== false) {
    const people = await db.select({ email: users.email, opted: users.emailNotifications })
      .from(users).where(inArray(users.id, recipients));
    // fire-and-forget: email latency must not slow API responses
    void Promise.all(people.filter((p) => p.opted)
      .map((p) => sendEmail(p.email, input.title, input.body ?? input.title, input.link)));
  }
  return rows;
}
