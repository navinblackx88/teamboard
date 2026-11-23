/**
 * Demo data: one workspace, two projects, three sprints of history (for velocity and burndown),
 * ~45 tasks, comments with mentions, and activity. All users' password: password123
 *
 *   npm run db:seed            (refuses to run if users already exist; pass --force to wipe first)
 */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { redis } from "../lib/redis.js";
import { db, pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import {
  comments, labels, projectMembers, projects, sprints, tasks, users, workspaceMembers, workspaces,
  type Role, type TaskStatus,
} from "./schema.js";
import { createTask } from "../modules/tasks/task.service.js";
import { logActivity } from "../modules/activity/activity.service.js";

const DAY = 86400_000;
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * DAY);

async function main() {
  await runMigrations();
  const [{ n }] = (await pool.query("select count(*)::int as n from users")).rows;
  if (n > 0) {
    if (!process.argv.includes("--force")) {
      console.log("Database already has users; skipping seed (use --force to wipe and reseed).");
      return;
    }
    const tables = (await pool.query(`select tablename from pg_tables where schemaname='public'`)).rows.map((r) => `"${r.tablename}"`);
    await pool.query(`truncate ${tables.join(",")} cascade`);
  }

  const hash = await bcrypt.hash("password123", 10);
  const people: [string, string, Role][] = [
    ["Aisha Khan", "aisha@acme.dev", "admin"],
    ["Marco Rossi", "marco@acme.dev", "project_manager"],
    ["Priya Nair", "priya@acme.dev", "developer"],
    ["Tom Becker", "tom@acme.dev", "developer"],
    ["Lena Park", "lena@acme.dev", "developer"],
    ["Sam Ortiz", "sam@acme.dev", "viewer"],
  ];
  const u = await db.insert(users).values(people.map(([name, email]) => ({
    name, email, passwordHash: hash, emailNotifications: true, // demo emails land in Mailpit (http://localhost:8025)
    avatarUrl: null,
  }))).returning();
  const [aisha, marco, priya, tom, lena] = u;

  const [ws] = await db.insert(workspaces).values({ name: "Acme Inc", slug: "acme", ownerId: aisha.id, settings: { timezone: "Asia/Kolkata" } }).returning();
  await db.insert(workspaceMembers).values(u.map((x, i) => ({ workspaceId: ws.id, userId: x.id, role: people[i][2], joinedAt: daysAgo(60 - i) })));

  const mkProject = async (name: string, key: string, color: string, description: string, members: typeof u) => {
    const [p] = await db.insert(projects).values({ workspaceId: ws.id, name, key, color, description, leadId: marco.id, settings: { defaultSprintLengthDays: 14, wipLimits: { in_progress: 6, review: 4 } } }).returning();
    await db.insert(projectMembers).values(members.map((m) => ({ projectId: p.id, userId: m.id })));
    const ls = await db.insert(labels).values([
      { projectId: p.id, name: "bug", color: "#ef4444" }, { projectId: p.id, name: "feature", color: "#22c55e" },
      { projectId: p.id, name: "improvement", color: "#3b82f6" }, { projectId: p.id, name: "design", color: "#a855f7" },
      { projectId: p.id, name: "backend", color: "#f59e0b" },
    ]).returning();
    await logActivity({ workspaceId: ws.id, projectId: p.id, actorId: marco.id, action: "project.created", entityType: "project", entityId: p.id, summary: `created project ${name}` });
    return { project: p, label: Object.fromEntries(ls.map((l) => [l.name, l.id])) };
  };

  const web = await mkProject("Customer Portal", "WEB", "#6366f1", "Self-service portal for fleet customers: bookings, invoices and support.", [aisha, marco, priya, tom, lena, u[5]]);
  const mob = await mkProject("Rider App", "MOB", "#0ea5e9", "React Native app for riders.", [marco, tom, lena]);

  // Sprints: two completed, one active (day 6 of 14), one planned.
  const sp = await db.insert(sprints).values([
    { projectId: web.project.id, name: "WEB Sprint 1", goal: "Auth and account basics", status: "planned", startDate: daysAgo(34), endDate: daysAgo(20), startedAt: daysAgo(34), completedAt: daysAgo(20), committedPoints: 26, completedPoints: 21 },
    { projectId: web.project.id, name: "WEB Sprint 2", goal: "Bookings flow", status: "planned", startDate: daysAgo(20), endDate: daysAgo(6), startedAt: daysAgo(20), completedAt: daysAgo(6), committedPoints: 30, completedPoints: 28 },
    { projectId: web.project.id, name: "WEB Sprint 3", goal: "Invoices, payments and notifications", status: "planned", startDate: daysAgo(6), endDate: new Date(now + 8 * DAY), startedAt: daysAgo(6), committedPoints: 34 },
    { projectId: web.project.id, name: "WEB Sprint 4", goal: "Support centre", status: "planned", startDate: new Date(now + 8 * DAY), endDate: new Date(now + 22 * DAY) },
  ]).returning();
  const [s1, s2, s3, s4] = sp;

  type Spec = [title: string, status: TaskStatus, pts: number, prio: "low" | "medium" | "high" | "urgent", who: typeof u, labels: string[], sprint: typeof s1 | null, doneDaysAgo?: number, dueInDays?: number];
  const webTasks: Spec[] = [
    // Sprint 1 (completed)
    ["Email + password sign-in", "done", 5, "high", [priya], ["feature", "backend"], s1, 30],
    ["Google OAuth sign-in", "done", 5, "high", [tom], ["feature"], s1, 27],
    ["Password reset emails", "done", 3, "medium", [priya], ["feature", "backend"], s1, 25],
    ["Account settings page", "done", 5, "medium", [lena], ["feature", "design"], s1, 22],
    ["Session timeout handling", "done", 3, "medium", [tom], ["improvement"], s1, 21],
    // Sprint 2 (completed)
    ["Booking calendar component", "done", 8, "high", [lena], ["feature", "design"], s2, 16],
    ["Booking API endpoints", "done", 5, "high", [priya], ["backend"], s2, 14],
    ["Availability caching", "done", 5, "medium", [tom], ["backend", "improvement"], s2, 11],
    ["Cancel / reschedule booking", "done", 5, "medium", [priya], ["feature"], s2, 9],
    ["Booking confirmation email", "done", 5, "low", [lena], ["feature"], s2, 7],
    // Sprint 3 (active): mix of states, completions spread over the last 6 days
    ["Invoice list with filters", "done", 5, "high", [priya], ["feature"], s3, 5],
    ["Invoice PDF generation", "done", 5, "high", [tom], ["backend"], s3, 3],
    ["Fix rounding in GST totals", "done", 2, "urgent", [priya], ["bug", "backend"], s3, 2],
    ["Stripe payment intent flow", "review", 8, "urgent", [tom, priya], ["feature", "backend"], s3, undefined, 1],
    ["Saved cards UI", "in_progress", 5, "high", [lena], ["feature", "design"], s3, undefined, 3],
    ["Payment failure retry emails", "in_progress", 3, "medium", [priya], ["backend"], s3, undefined, 5],
    ["In-app notification centre", "backlog", 3, "medium", [lena], ["feature"], s3, undefined, 7],
    ["Webhook signature verification", "backlog", 3, "high", [tom], ["backend", "bug"], s3, undefined, 2],
    // Sprint 4 (planned)
    ["Support ticket form", "backlog", 5, "medium", [lena], ["feature"], s4],
    ["Ticket status page", "backlog", 3, "low", [], ["feature"], s4],
    ["Knowledge base search", "backlog", 8, "medium", [priya], ["feature", "backend"], s4],
    // Backlog
    ["Dark mode", "backlog", 3, "low", [], ["design", "improvement"], null],
    ["Export bookings to CSV", "backlog", 2, "low", [], ["feature"], null],
    ["Audit log for admins", "backlog", 5, "medium", [], ["feature", "backend"], null],
    ["Accessibility pass on forms", "backlog", 3, "medium", [lena], ["improvement", "design"], null],
    ["Rate-limit login endpoint", "backlog", 2, "high", [tom], ["backend"], null, undefined, 4],
    ["Multi-language support", "backlog", 8, "low", [], ["feature"], null],
    ["Mobile layout for invoices", "backlog", 3, "medium", [], ["bug", "design"], null],
  ];
  const mobTasks: Spec[] = [
    ["Ride history screen", "in_progress", 5, "high", [tom], ["feature"], null, undefined, 2],
    ["Push notification setup", "review", 3, "medium", [lena], ["feature"], null],
    ["Crash on Android 12 resume", "in_progress", 2, "urgent", [tom], ["bug"], null, undefined, 1],
    ["Offline map tiles", "backlog", 8, "medium", [], ["feature"], null],
    ["App store screenshots", "backlog", 2, "low", [lena], ["design"], null],
    ["Battery level widget", "done", 3, "medium", [lena], ["feature"], null, 4],
  ];

  const createAll = async (ctx: typeof web, specs: Spec[]) => {
    const created = [];
    for (const [title, status, pts, prio, who, lbls, sprint, doneAgo, dueIn] of specs) {
      const t = await createTask(ctx.project, marco.id, {
        title, status, storyPoints: pts, priority: prio, sprintId: sprint?.id ?? null,
        assigneeIds: who.map((w) => w.id), labelIds: lbls.map((l) => ctx.label[l]),
        dueDate: dueIn !== undefined ? new Date(now + dueIn * DAY) : null,
        description: `${title}.\n\n**Acceptance criteria**\n- Works on desktop and mobile\n- Covered by tests`,
      });
      const createdAt = sprint?.startDate ? new Date(sprint.startDate.getTime() - DAY) : daysAgo(10);
      await db.update(tasks).set({ createdAt, completedAt: doneAgo !== undefined ? daysAgo(doneAgo) : null }).where(eq(tasks.id, t.id));
      created.push(t);
    }
    return created;
  };
  const wt = await createAll(web, webTasks);
  await createAll(mob, mobTasks);
  // Now close out history (tasks can't be added to completed sprints through the service).
  await db.update(sprints).set({ status: "completed" }).where(sql`${sprints.id} in (${s1.id}, ${s2.id})`);
  await db.update(sprints).set({ status: "active" }).where(eq(sprints.id, s3.id));

  // Subtasks on the payment flow
  const stripe = wt.find((t) => t.title.startsWith("Stripe"))!;
  for (const [title, status] of [["Create payment intent endpoint", "done"], ["3-D Secure challenge handling", "review"], ["Idempotency keys", "done"]] as const) {
    await createTask(web.project, priya.id, { title, status, parentId: stripe.id, assigneeIds: [priya.id] });
  }

  // Conversation with mentions
  const [c1] = await db.insert(comments).values({ taskId: stripe.id, authorId: tom.id, body: `PR is up. @[Priya Nair](${priya.id}) can you review the webhook handling?`, mentionedUserIds: [priya.id], createdAt: daysAgo(1) }).returning();
  await db.insert(comments).values([
    { taskId: stripe.id, authorId: priya.id, parentId: c1.id, body: "Looking now. Left two comments on the retry logic.", createdAt: new Date(now - 20 * 3600_000) },
    { taskId: stripe.id, authorId: marco.id, body: `Let's get this merged before Thursday's demo. @[Tom Becker](${tom.id})`, mentionedUserIds: [tom.id], createdAt: new Date(now - 3 * 3600_000) },
  ]);
  await logActivity({ workspaceId: ws.id, projectId: web.project.id, taskId: stripe.id, actorId: tom.id, action: "comment.created", entityType: "comment", entityId: c1.id, summary: `commented on ${stripe.key}` });
  await logActivity({ workspaceId: ws.id, projectId: web.project.id, actorId: marco.id, action: "sprint.started", entityType: "sprint", entityId: s3.id, summary: "started WEB Sprint 3 with 34 points committed" });

  // Spread activity timestamps so the feed looks lived-in.
  await db.execute(sql`update activity_logs set created_at = now() - (random() * interval '7 days') where action <> 'comment.created'`);

  console.log(`Seeded workspace "${ws.name}". Sign in as aisha@acme.dev (admin), marco@acme.dev (PM), priya@acme.dev (developer) or sam@acme.dev (viewer); password: password123`);
}

// Close every connection (Redis included) and exit, so `seed && start` sequences continue.
main()
  .then(async () => { await pool.end(); redis?.disconnect(); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
