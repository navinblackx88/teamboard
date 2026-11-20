import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import SwaggerParser from "@apidevtools/swagger-parser";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { tasks } from "../src/db/schema.js";
import { checkDeadlines } from "../src/jobs/deadlines.js";
import { openapiPath } from "../src/app.js";
import { addMember, as, signup, startServer, stopServer, wait, type Ctx, type TestUser } from "./helpers.js";

let ctx: Ctx;
let admin: TestUser, pm: TestUser, dev: TestUser, viewer: TestUser, outsider: TestUser;
let wsId: string, projectId: string;
let labelBug: string;

beforeAll(async () => {
  ctx = await startServer();
  admin = await signup(ctx, "Ada Admin");
  const ws = await as(ctx, admin).post("/workspaces", { name: "Acme Corp" });
  wsId = ws.body.id;
  pm = await addMember(ctx, admin, wsId, "Pat", "project_manager");
  dev = await addMember(ctx, admin, wsId, "Dev", "developer");
  viewer = await addMember(ctx, admin, wsId, "Vic", "viewer");
  outsider = await signup(ctx, "Olly Outsider");
});
afterAll(() => stopServer(ctx));

describe("auth", () => {
  it("logs in, rejects bad passwords, and returns the profile", async () => {
    const ok = await ctx.api.post("/api/v1/auth/login").send({ email: admin.email.toUpperCase(), password: "password123" });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const bad = await ctx.api.post("/api/v1/auth/login").send({ email: admin.email, password: "nope-nope" });
    expect(bad.status).toBe(401);
    const meRes = await as(ctx, admin).get("/auth/me");
    expect(meRes.body.workspaces).toEqual([expect.objectContaining({ id: wsId, role: "admin" })]);
  });

  it("rotates refresh tokens and rejects reuse", async () => {
    const u = await signup(ctx, "Rita Refresh");
    const first = await ctx.api.post("/api/v1/auth/refresh").send({ refreshToken: u.refresh });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(u.refresh);
    const reuse = await ctx.api.post("/api/v1/auth/refresh").send({ refreshToken: u.refresh });
    expect(reuse.status).toBe(401);
    await ctx.api.post("/api/v1/auth/logout").send({ refreshToken: first.body.refreshToken }).expect(204);
    expect((await ctx.api.post("/api/v1/auth/refresh").send({ refreshToken: first.body.refreshToken })).status).toBe(401);
  });

  it("rejects duplicate emails, missing tokens, and reports Google as disabled", async () => {
    expect((await ctx.api.post("/api/v1/auth/signup").send({ name: "x", email: admin.email, password: "password123" })).status).toBe(409);
    expect((await ctx.api.get("/api/v1/auth/me")).status).toBe(401);
    expect((await ctx.api.get("/api/v1/auth/providers")).body).toEqual({ google: false });
    expect((await ctx.api.post("/api/v1/auth/google").send({ idToken: "abcdefghijkl" })).status).toBe(501);
  });
});

describe("workspaces & RBAC", () => {
  it("lists members with roles", async () => {
    const res = await as(ctx, dev).get(`/workspaces/${wsId}/members`);
    expect(res.body.items.map((m: { role: string }) => m.role).sort()).toEqual(["admin", "developer", "project_manager", "viewer"]);
    const filtered = await as(ctx, dev).get(`/workspaces/${wsId}/members?q=pat`);
    expect(filtered.body.items).toHaveLength(1);
  });

  it("hides workspaces from non-members (404) and blocks role escalation", async () => {
    expect((await as(ctx, outsider).get(`/workspaces/${wsId}`)).status).toBe(404);
    expect((await as(ctx, dev).patch(`/workspaces/${wsId}`, { name: "Hacked" })).status).toBe(403);
    expect((await as(ctx, dev).post(`/workspaces/${wsId}/invitations`, { email: "z@example.com" })).status).toBe(403);
  });

  it("enforces invitation email matching and single use", async () => {
    const inv = await as(ctx, admin).post(`/workspaces/${wsId}/invitations`, { email: "someone@example.com", role: "developer" });
    const token = new URL(inv.body.inviteUrl).pathname.split("/").pop()!;
    const preview = await ctx.api.get(`/api/v1/invitations/${token}`);
    expect(preview.body).toMatchObject({ workspaceName: "Acme Corp", role: "developer", status: "pending" });
    expect((await as(ctx, outsider).post(`/invitations/${token}/accept`)).status).toBe(403);
    expect((await as(ctx, admin).post(`/workspaces/${wsId}/invitations`, { email: dev.email })).status).toBe(409);
  });

  it("protects the owner and the last admin", async () => {
    expect((await as(ctx, admin).patch(`/workspaces/${wsId}/members/${admin.id}`, { role: "developer" })).status).toBe(403);
    expect((await as(ctx, admin).delete(`/workspaces/${wsId}/members/${admin.id}`)).status).toBe(403);
    const r = await as(ctx, admin).patch(`/workspaces/${wsId}/members/${viewer.id}`, { role: "developer" });
    expect(r.status).toBe(200);
    await as(ctx, admin).patch(`/workspaces/${wsId}/members/${viewer.id}`, { role: "viewer" }).expect(200);
  });

  it("returns permissions for the current role", async () => {
    const res = await as(ctx, viewer).get(`/workspaces/${wsId}`);
    expect(res.body.permissions).toEqual(["read"]);
  });
});

describe("projects", () => {
  it("lets PMs create projects with default labels, and blocks developers", async () => {
    expect((await as(ctx, dev).post(`/workspaces/${wsId}/projects`, { name: "Nope", key: "NO" })).status).toBe(403);
    const res = await as(ctx, pm).post(`/workspaces/${wsId}/projects`, { name: "Website", key: "web", memberIds: [dev.id, viewer.id] });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("WEB");
    projectId = res.body.id;
    const detail = await as(ctx, dev).get(`/projects/${projectId}`);
    expect(detail.body.members).toHaveLength(3);
    expect(detail.body.labels.map((l: { name: string }) => l.name)).toContain("bug");
    labelBug = detail.body.labels.find((l: { name: string }) => l.name === "bug").id;
    expect((await as(ctx, pm).post(`/workspaces/${wsId}/projects`, { name: "Dupe", key: "WEB" })).status).toBe(409);
  });

  it("hides projects from non-member developers", async () => {
    const secret = await as(ctx, pm).post(`/workspaces/${wsId}/projects`, { name: "Secret", key: "SEC" });
    expect((await as(ctx, dev).get(`/projects/${secret.body.id}`)).status).toBe(404);
    const list = await as(ctx, dev).get(`/workspaces/${wsId}/projects`);
    expect(list.body.items.map((p: { key: string }) => p.key)).toEqual(["WEB"]);
    const adminList = await as(ctx, admin).get(`/workspaces/${wsId}/projects`);
    expect(adminList.body.items).toHaveLength(2);
  });
});

describe("tasks", () => {
  const ids: string[] = [];

  it("creates tasks with sequential keys and notifies assignees", async () => {
    for (let i = 1; i <= 7; i++) {
      const res = await as(ctx, dev).post(`/projects/${projectId}/tasks`, {
        title: `Task ${i}`, storyPoints: i, priority: i === 1 ? "urgent" : "medium",
        assigneeIds: i <= 3 ? [dev.id] : [], labelIds: i === 2 ? [labelBug] : [],
      });
      expect(res.status).toBe(201);
      expect(res.body.key).toBe(`WEB-${i}`);
      ids.push(res.body.id);
    }
    // dev assigned themselves → no self-notification; PM assigns dev → notification
    await as(ctx, pm).patch(`/tasks/${ids[3]}`, { assigneeIds: [dev.id] }).expect(200);
    const notes = await as(ctx, dev).get("/notifications");
    expect(notes.body.items.filter((n: { type: string }) => n.type === "task_assigned")).toHaveLength(1);
    expect(notes.body.items[0].title).toContain("WEB-4");
  });

  it("blocks viewers from writing", async () => {
    expect((await as(ctx, viewer).post(`/projects/${projectId}/tasks`, { title: "x" })).status).toBe(403);
    expect((await as(ctx, viewer).get(`/projects/${projectId}/tasks`)).status).toBe(200);
  });

  it("validates input", async () => {
    const res = await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "", storyPoints: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["title", "storyPoints"]));
  });

  it("paginates with cursors and no duplicates", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await as(ctx, dev).get(`/projects/${projectId}/tasks?limit=3&sort=created${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.items.map((t: { id: string }) => t.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect(seen[0]).toBe(ids[6]); // newest first
  });

  it("filters by assignee, label, priority and key", async () => {
    const mine = await as(ctx, dev).get(`/projects/${projectId}/tasks?assigneeId=me`);
    expect(mine.body.items).toHaveLength(4);
    const bugs = await as(ctx, dev).get(`/projects/${projectId}/tasks?labelId=${labelBug}`);
    expect(bugs.body.items.map((t: { key: string }) => t.key)).toEqual(["WEB-2"]);
    const urgent = await as(ctx, dev).get(`/projects/${projectId}/tasks?priority=urgent,high`);
    expect(urgent.body.items).toHaveLength(1);
    const byKey = await as(ctx, dev).get(`/projects/${projectId}/tasks?q=web-5`);
    expect(byKey.body.items.map((t: { key: string }) => t.key)).toEqual(["WEB-5"]);
    const unassigned = await as(ctx, dev).get(`/projects/${projectId}/tasks?assigneeId=unassigned`);
    expect(unassigned.body.items).toHaveLength(3);
  });

  it("moves cards between columns at exact positions", async () => {
    // Put 1, 2, 3 into in_progress, then drop 4 between 1 and 2.
    for (const i of [0, 1, 2]) await as(ctx, dev).post(`/tasks/${ids[i]}/move`, { status: "in_progress" }).expect(200);
    const moved = await as(ctx, dev).post(`/tasks/${ids[3]}/move`, { status: "in_progress", afterId: ids[0], beforeId: ids[1] });
    expect(moved.status).toBe(200);
    // Drop 5 at the top of the column.
    await as(ctx, dev).post(`/tasks/${ids[4]}/move`, { status: "in_progress", beforeId: ids[0] }).expect(200);
    const board = await as(ctx, dev).get(`/projects/${projectId}/tasks/board`);
    expect(board.body.columns.in_progress.map((t: { key: string }) => t.key)).toEqual(["WEB-5", "WEB-1", "WEB-4", "WEB-2", "WEB-3"]);
    expect(board.body.columns.backlog.map((t: { key: string }) => t.key)).toEqual(["WEB-6", "WEB-7"]);
    // Neighbour from another column is rejected.
    expect((await as(ctx, dev).post(`/tasks/${ids[5]}/move`, { status: "review", afterId: ids[0] })).status).toBe(400);
  });

  it("sets completedAt when done and clears it when reopened", async () => {
    const done = await as(ctx, dev).post(`/tasks/${ids[6]}/move`, { status: "done" });
    expect(done.body.completedAt).toBeTruthy();
    const reopened = await as(ctx, dev).patch(`/tasks/${ids[6]}`, { status: "review" });
    expect(reopened.body.completedAt).toBeNull();
  });

  it("supports one level of subtasks", async () => {
    const sub = await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "Sub A", parentId: ids[0] });
    expect(sub.status).toBe(201);
    await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "Sub B", parentId: ids[0], status: "done" }).expect(201);
    expect((await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "Nested", parentId: sub.body.id })).status).toBe(400);
    const detail = await as(ctx, dev).get(`/tasks/${ids[0]}`);
    expect(detail.body.subtasks).toHaveLength(2);
    expect(detail.body).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1, canEdit: true });
    // Subtasks don't appear as board cards.
    const board = await as(ctx, dev).get(`/projects/${projectId}/tasks/board`);
    const all = Object.values(board.body.columns).flat() as { title: string }[];
    expect(all.find((t) => t.title === "Sub A")).toBeUndefined();
  });

  it("lists my tasks across the workspace", async () => {
    const res = await as(ctx, dev).get(`/me/tasks?workspaceId=${wsId}&limit=2`);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeTruthy();
  });

  it("only lets reporters or managers delete", async () => {
    const t = await as(ctx, pm).post(`/projects/${projectId}/tasks`, { title: "PM's task" });
    expect((await as(ctx, dev).delete(`/tasks/${t.body.id}`)).status).toBe(403);
    await as(ctx, pm).delete(`/tasks/${t.body.id}`).expect(204);
    expect((await as(ctx, dev).get(`/tasks/${t.body.id}`)).status).toBe(404);
  });
});

describe("sprints", () => {
  let sprintId: string, nextSprintId: string;
  let taskIds: string[];

  it("plans, starts and enforces one active sprint", async () => {
    expect((await as(ctx, dev).post(`/projects/${projectId}/sprints`, {})).status).toBe(403);
    const s = await as(ctx, pm).post(`/projects/${projectId}/sprints`, { goal: "Ship v1" });
    expect(s.body.name).toBe("WEB Sprint 1");
    sprintId = s.body.id;
    nextSprintId = (await as(ctx, pm).post(`/projects/${projectId}/sprints`, { name: "Next" })).body.id;

    const list = await as(ctx, dev).get(`/projects/${projectId}/tasks?sort=created&limit=50`);
    taskIds = list.body.items.slice(0, 4).map((t: { id: string }) => t.id); // WEB-7..WEB-4: points 7+6+5+4 = 22
    const added = await as(ctx, pm).post(`/sprints/${sprintId}/tasks`, { taskIds });
    expect(added.body.stats).toMatchObject({ totalTasks: 4, totalPoints: 22 });

    const start = new Date(Date.now() - 2 * 86400_000);
    const started = await as(ctx, pm).post(`/sprints/${sprintId}/start`, { startDate: start, endDate: new Date(start.getTime() + 10 * 86400_000) });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: "active", committedPoints: 22 });
    expect((await as(ctx, pm).post(`/sprints/${nextSprintId}/start`, {})).status).toBe(409);
    // Members were notified
    const notes = await as(ctx, dev).get("/notifications");
    expect(notes.body.items.some((n: { type: string }) => n.type === "sprint_started")).toBe(true);
  });

  it("shows the active sprint on the board and builds a burndown", async () => {
    await as(ctx, dev).post(`/tasks/${taskIds[0]}/move`, { status: "done" }).expect(200); // 7 points
    const board = await as(ctx, dev).get(`/projects/${projectId}/tasks/board?sprintId=active`);
    expect(board.body.sprintId).toBe(sprintId);
    expect(Object.values(board.body.columns).flat()).toHaveLength(4);

    const bd = await as(ctx, dev).get(`/sprints/${sprintId}/burndown`);
    expect(bd.body.committedPoints).toBe(22);
    expect(bd.body.days).toHaveLength(11);
    expect(bd.body.days[0].ideal).toBe(22);
    expect(bd.body.days[10].ideal).toBe(0);
    const today = bd.body.days.filter((d: { remaining: number | null }) => d.remaining !== null).at(-1);
    expect(today.remaining).toBe(15);
    expect(bd.body.days.at(-1).remaining).toBeNull(); // future
  });

  it("completes the sprint, carries over unfinished work, and reports velocity", async () => {
    const done = await as(ctx, pm).post(`/sprints/${sprintId}/complete`, { moveIncompleteTo: nextSprintId });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", completedPoints: 7, movedCount: 3 });
    const next = await as(ctx, dev).get(`/sprints/${nextSprintId}`);
    expect(next.body.stats.totalTasks).toBe(3);
    const vel = await as(ctx, dev).get(`/projects/${projectId}/sprints/velocity`);
    expect(vel.body.items).toEqual([expect.objectContaining({ committed: 22, completed: 7 })]);
    expect(vel.body.averageVelocity).toBe(7);
    expect((await as(ctx, pm).delete(`/sprints/${sprintId}`)).status).toBe(400);
  });
});

describe("comments & mentions", () => {
  let taskId: string;
  it("threads replies and notifies mentioned users and watchers", async () => {
    taskId = (await as(ctx, pm).post(`/projects/${projectId}/tasks`, { title: "Discuss API", assigneeIds: [dev.id] })).body.id;
    const c = await as(ctx, viewer).post(`/tasks/${taskId}/comments`, { body: "x" });
    expect(c.status).toBe(403);

    const root = await as(ctx, dev).post(`/tasks/${taskId}/comments`, { body: `Thoughts @[Pat](${pm.id})? cc @[Olly](${outsider.id})` });
    expect(root.status).toBe(201);
    expect(root.body.mentionedUserIds).toEqual([pm.id]); // outsider isn't a member → ignored
    await as(ctx, pm).post(`/tasks/${taskId}/comments`, { body: "Yes, looks good", parentId: root.body.id }).expect(201);

    const thread = await as(ctx, dev).get(`/tasks/${taskId}/comments`);
    expect(thread.body.items).toHaveLength(1);
    expect(thread.body.items[0].replies[0].body).toBe("Yes, looks good");

    const pmNotes = await as(ctx, pm).get("/notifications?unreadOnly=true");
    const mention = pmNotes.body.items.find((n: { type: string }) => n.type === "mentioned");
    expect(mention.body).toBe("Thoughts @Pat? cc @Olly");
    const devNotes = await as(ctx, dev).get("/notifications");
    expect(devNotes.body.items[0]).toMatchObject({ type: "comment_added" }); // dev is assignee + earlier commenter
  });

  it("soft-deletes comments but keeps their replies", async () => {
    const thread = await as(ctx, dev).get(`/tasks/${taskId}/comments`);
    const root = thread.body.items[0];
    expect((await as(ctx, viewer).delete(`/comments/${root.id}`)).status).toBe(403);
    expect((await as(ctx, pm).patch(`/comments/${root.id}`, { body: "edited" })).status).toBe(403);
    await as(ctx, dev).delete(`/comments/${root.id}`).expect(204);
    const after = await as(ctx, dev).get(`/tasks/${taskId}/comments`);
    expect(after.body.items[0]).toMatchObject({ body: "" });
    expect(after.body.items[0].replies).toHaveLength(1);
    expect(after.body.total).toBe(1);
  });

  it("marks notifications read", async () => {
    const before = await as(ctx, pm).get("/notifications/unread-count");
    expect(before.body.count).toBeGreaterThan(0);
    await as(ctx, pm).post("/notifications/read-all").expect(200);
    expect((await as(ctx, pm).get("/notifications/unread-count")).body.count).toBe(0);
  });
});

describe("attachments", () => {
  it("uploads, lists, downloads through a signed link, and enforces delete rights", async () => {
    const taskId = (await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "With files" })).body.id;
    const up = await as(ctx, dev).upload(`/tasks/${taskId}/attachments`)
      .attach("files", Buffer.from("hello world"), { filename: "notes.txt", contentType: "text/plain" })
      .attach("files", Buffer.from("%PDF-1.4"), { filename: "spec.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(201);
    expect(up.body.items).toHaveLength(2);
    expect(up.body.items[0]).not.toHaveProperty("storageKey");

    expect((await as(ctx, dev).upload(`/tasks/${taskId}/attachments`).attach("files", Buffer.from("x"), "evil.exe")).status).toBe(400);
    expect((await as(ctx, viewer).upload(`/tasks/${taskId}/attachments`).attach("files", Buffer.from("x"), "a.txt")).status).toBe(403);

    const att = up.body.items.find((a: { filename: string }) => a.filename === "notes.txt");
    const { body: { url } } = await as(ctx, viewer).get(`/attachments/${att.id}/url`);
    const file = await ctx.api.get(new URL(url).pathname + new URL(url).search);
    expect(file.status).toBe(200);
    expect(file.text ?? file.body.toString()).toBe("hello world");
    expect((await ctx.api.get(`/api/v1/files/${att.id}?sig=forged`)).status).toBe(401);

    expect((await as(ctx, viewer).delete(`/attachments/${att.id}`)).status).toBe(403);
    await as(ctx, pm).delete(`/attachments/${att.id}`).expect(204);
    const detail = await as(ctx, dev).get(`/tasks/${taskId}`);
    expect(detail.body.attachmentCount).toBe(1);
  });
});

describe("activity log", () => {
  it("paginates with totals and filters", async () => {
    const p1 = await as(ctx, admin).get(`/workspaces/${wsId}/activity?pageSize=5`);
    expect(p1.body.items).toHaveLength(5);
    expect(p1.body.total).toBeGreaterThan(20);
    expect(p1.body.totalPages).toBe(Math.ceil(p1.body.total / 5));
    const p2 = await as(ctx, admin).get(`/workspaces/${wsId}/activity?pageSize=5&page=2`);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);

    const sprintsOnly = await as(ctx, admin).get(`/workspaces/${wsId}/activity?action=sprint.`);
    expect(sprintsOnly.body.items.every((a: { action: string }) => a.action.startsWith("sprint."))).toBe(true);
    expect(sprintsOnly.body.items.map((a: { action: string }) => a.action)).toContain("sprint.completed");

    const byActor = await as(ctx, admin).get(`/workspaces/${wsId}/activity?actorId=${pm.id}&entityType=task`);
    expect(byActor.body.items.every((a: { actor: { id: string } }) => a.actor.id === pm.id)).toBe(true);
  });

  it("hides activity from projects a developer can't see", async () => {
    const devView = await as(ctx, dev).get(`/workspaces/${wsId}/activity?pageSize=100`);
    expect(devView.body.items.some((a: { summary: string }) => a.summary.includes("Secret"))).toBe(false);
    const adminView = await as(ctx, admin).get(`/workspaces/${wsId}/activity?pageSize=100`);
    expect(adminView.body.items.some((a: { summary: string }) => a.summary.includes("Secret"))).toBe(true);
  });
});

describe("dashboard", () => {
  it("summarises projects, my tasks, sprints and deadlines, and stays fresh after changes", async () => {
    const soon = new Date(Date.now() + 3 * 86400_000);
    const t = await as(ctx, dev).post(`/projects/${projectId}/tasks`, { title: "Due soon", assigneeIds: [dev.id], dueDate: soon });
    const d1 = await as(ctx, dev).get(`/workspaces/${wsId}/dashboard`);
    expect(d1.status).toBe(200);
    expect(d1.body.projects.map((p: { key: string }) => p.key)).toEqual(["WEB"]);
    expect(d1.body.upcomingDeadlines.map((x: { id: string }) => x.id)).toContain(t.body.id);
    expect(d1.body.myTasks.items[0].id).toBe(t.body.id); // soonest due first
    const before = d1.body.myTasks.total;

    await as(ctx, pm).post(`/projects/${projectId}/tasks`, { title: "Another", assigneeIds: [dev.id] }).expect(201);
    const d2 = await as(ctx, dev).get(`/workspaces/${wsId}/dashboard`);
    expect(d2.body.myTasks.total).toBe(before + 1); // cache invalidated by activity
  });
});

describe("aggregate counts (regression: correlated subqueries)", () => {
  it("reports correct per-project stats and sprint progress", async () => {
    const list = await as(ctx, pm).get(`/workspaces/${wsId}/projects`);
    const web = list.body.items.find((p: { key: string }) => p.key === "WEB");
    const [{ n }] = (await import("../src/db/index.js")).pool.query
      ? (await (await import("../src/db/index.js")).pool.query(`select count(*)::int as n from tasks where project_id = $1 and parent_id is null`, [projectId])).rows
      : [{ n: -1 }];
    expect(web.stats.total).toBe(n);
    expect(web.memberCount).toBe(3);
    expect(web.activeSprint).toBeNull(); // sprint 1 completed; "Next" is planned

    const next = (await as(ctx, pm).get(`/projects/${projectId}/sprints?status=planned`)).body.items.find((s: { name: string }) => s.name === "Next");
    await as(ctx, pm).post(`/sprints/${next.id}/start`, {}).expect(200);
    const dash = await as(ctx, pm).get(`/workspaces/${wsId}/dashboard`);
    const active = dash.body.activeSprints.find((s: { id: string }) => s.id === next.id);
    expect(active).toMatchObject({ totalTasks: next.stats.totalTasks, totalPoints: next.stats.totalPoints, doneTasks: next.stats.doneTasks });
    expect(active.totalTasks).toBe(3);
    const after = (await as(ctx, pm).get(`/workspaces/${wsId}/projects`)).body.items.find((p: { key: string }) => p.key === "WEB");
    expect(after.activeSprint).toMatchObject({ id: next.id, name: "Next" });
  });
});

describe("deadline notifications", () => {
  it("notifies assignees once for tasks due within the window", async () => {
    const due = new Date(Date.now() + 2 * 3600_000);
    const t = await as(ctx, pm).post(`/projects/${projectId}/tasks`, { title: "Hotfix", assigneeIds: [dev.id], dueDate: due });
    expect(await checkDeadlines()).toBeGreaterThanOrEqual(1);
    await wait(1100);
    const { redis } = await import("../src/lib/redis.js");
    await redis?.del("lock:deadline-job");
    expect(await checkDeadlines()).toBe(0); // not re-sent
    const notes = await as(ctx, dev).get("/notifications?limit=50");
    const hits = notes.body.items.filter((n: { type: string; data: { taskId: string } }) => n.type === "deadline_approaching" && n.data.taskId === t.body.id);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toMatch(/due in 2 hours/);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.body.id));
    expect(row.deadlineNotifiedAt).toBeTruthy();
  });
});

describe("realtime", () => {
  const open = (token: string) => new Promise<Socket>((resolve, reject) => {
    const s = connect(ctx.url, { auth: { token }, transports: ["websocket"], forceNew: true });
    s.on("connect", () => resolve(s));
    s.on("connect_error", (e) => { s.close(); reject(e); });
  });

  it("rejects connections without a valid token", async () => {
    await expect(open("garbage")).rejects.toThrow("unauthorized");
  });

  it("pushes board moves, comments and notifications to the right rooms", async () => {
    const devSocket = await open(dev.token);
    const outsiderSocket = await open(outsider.token);
    try {
      const joined = await devSocket.emitWithAck("project:join", projectId);
      expect(joined).toEqual({ ok: true });
      expect(await outsiderSocket.emitWithAck("project:join", projectId)).toEqual({ ok: false });

      const outsiderEvents: string[] = [];
      outsiderSocket.onAny((e) => outsiderEvents.push(e));

      const t = await as(ctx, pm).post(`/projects/${projectId}/tasks`, { title: "Realtime card" });
      const moved = new Promise<{ task: { id: string; status: string }; fromStatus: string; actorId: string }>((r) => devSocket.once("task.moved", r));
      await as(ctx, pm).post(`/tasks/${t.body.id}/move`, { status: "review" }).expect(200);
      const evt = await moved;
      expect(evt).toMatchObject({ task: { id: t.body.id, status: "review" }, fromStatus: "backlog", actorId: pm.id });

      const notified = new Promise<{ notification: { type: string } }>((r) => devSocket.once("notification.created", r));
      await as(ctx, pm).patch(`/tasks/${t.body.id}`, { assigneeIds: [dev.id] }).expect(200);
      expect((await notified).notification.type).toBe("task_assigned");

      await wait(150);
      expect(outsiderEvents.filter((e) => e.startsWith("task."))).toEqual([]);
    } finally {
      devSocket.close();
      outsiderSocket.close();
    }
  });
});

describe("OpenAPI spec", () => {
  it("is valid and documents every route the server exposes", async () => {
    const api = await SwaggerParser.validate(openapiPath);
    const documented = new Set(Object.entries(api.paths ?? {}).flatMap(([p, ops]) =>
      Object.keys(ops as object).filter((m) => ["get", "post", "patch", "put", "delete"].includes(m)).map((m) => `${m.toUpperCase()} ${p.replace(/\{[^}]+\}/g, ":p")}`)));

    const { publicMounts, protectedMounts } = await import("../src/app.js");
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const apiRoutes = [...publicMounts, ...protectedMounts].flatMap(([mount, router]) =>
      (router as unknown as { stack: Layer[] }).stack.filter((l) => l.route).flatMap((l) =>
        Object.keys(l.route!.methods).map((m) => `${m.toUpperCase()} ${(mount + l.route!.path).replace(/\/$/, "")}`.replace(/:\w+/g, ":p"))));
    const missing = apiRoutes.filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
    expect(apiRoutes.length).toBe(documented.size);
  });
});

