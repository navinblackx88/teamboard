# TeamBoard: project management, Jira/Trello lite

Teams manage projects, tasks and sprints on a drag-and-drop Kanban board, with real-time updates,
role-based access, threaded comments with @mentions, file attachments, notifications and an activity log.

```
teamboard/
├── backend/     Node 22 · Express 5 · TypeScript · PostgreSQL (Drizzle ORM) · Redis · Socket.IO
│   ├── openapi.yaml      OpenAPI 3.0.3 spec: 49 paths, 71 operations (served at /api/docs)
│   ├── drizzle/          SQL migrations (applied automatically on start)
│   ├── src/modules/      auth · workspaces · projects · tasks · sprints · comments · files · notifications · activity · dashboard
│   └── tests/            integration tests against real Postgres + Redis
├── frontend/    React 19 · TypeScript · shadcn/ui (Radix) · Tailwind CSS 4 · React Query · Zustand · React DnD · Recharts · Socket.IO client
└── docker-compose.yml    Local demo stack: Postgres, API, web (nginx), Mailpit
```

## Quick start

**With Docker** (recommended for a local demo; no cloud services needed):
```bash
docker compose up --build
```
Open **http://localhost:8080** and sign in as `marco@acme.dev` / `password123`. Demo data is created on first start. API docs are at http://localhost:8080/api/docs, and every email the app sends appears in Mailpit at http://localhost:8025. Reset with `docker compose down -v`. See **[LOCAL-DEMO.md](LOCAL-DEMO.md)** for the architecture and a 10-minute demo script.

**Without Docker** (you need Postgres 16 and, optionally, Redis 7):
```bash
npm install                       # installs both workspaces
cp backend/.env.example backend/.env
npm run seed                      # migrations + demo data
npm run dev:api                   # http://localhost:4000
npm run dev:web                   # http://localhost:5173
```

Demo logins (password `password123`): `aisha@acme.dev` (Admin), `marco@acme.dev` (Project Manager),
`priya@acme.dev` (Developer), `sam@acme.dev` (Viewer). The seed includes two completed sprints
(for velocity), an active sprint mid-way (for the burndown), a planned sprint and a backlog.

## Deploy to Railway

One service built from the `Dockerfile` (serves the app and the API on one domain), Railway PostgreSQL and a volume for uploads. Redis and S3 are optional, only for scaling out. See **[DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md)**.

## Features

| Area | What's there |
|---|---|
| **Dashboard** | Open/overdue counts, my tasks, sprint progress with days left, deadlines in the next 14 days, project progress, recent activity. Cached in Redis per user and invalidated on every change. |
| **Kanban board** | Backlog → In Progress → Review → Done. Drag to an exact position, with a drop indicator and an optimistic update that rolls back on error. WIP limits, filters (sprint, assignee, label, priority, text), "who's viewing" presence. Touch drag on mobile; columns swipe. |
| **Tasks** | Per-project keys (`WEB-42`), subtasks (one level), priorities, story points, labels, multiple assignees, due dates, markdown descriptions, history. Search by title or key. |
| **Sprints** | Create, plan by dragging backlog ↔ sprint (or a menu on touch), start (freezes committed points; one active per project), complete (carries unfinished work to the backlog or the next sprint). **Burndown** (ideal vs remaining, scope changes shown) and **velocity** (committed vs completed, average), each with a table view. |
| **Collaboration** | Threaded comments, @mention autocomplete, edit/soft-delete, drag-and-drop file uploads (10 files, 25 MB each), live activity feed. |
| **Notifications** | In-app (bell with infinite scroll + live toasts) and email for: assigned, comment added, @mentioned, deadline approaching (background job; Redis lock so multiple instances don't double-send), invited, sprint started/completed. Users can opt out of email. |
| **Users & roles** | Email/password + Google OAuth2 (redirect flow, plus ID-token endpoint for One Tap). Invite by email with a role; allowed-domain restriction; owner and last-admin protection; can't invite above your own role. |
| **Activity log** | Page-numbered with total count; filter by type, project, person, task and date range. Filters live in the URL. |
| **Lists** | Infinite scroll via keyset cursors on My Tasks, backlog, sprint lists and notifications. |
| **Responsive** | Sidebar becomes a drawer, board columns snap-scroll, filters scroll horizontally, modals become bottom sheets. |

## Roles

| | Admin | Project Manager | Developer | Viewer |
|---|:-:|:-:|:-:|:-:|
| See all projects in the workspace | ✓ | ✓ | member projects | member projects |
| Create / edit / move tasks, comment, upload | ✓ | ✓ | ✓ | |
| Delete any task, moderate comments & files | ✓ | ✓ | own only | |
| Projects, sprints, labels, project members | ✓ | ✓ | | |
| Workspace settings, members, roles, invitations | ✓ | | | |

Enforced on the server (`src/lib/rbac.ts`, `src/lib/access.ts`); the UI hides what you can't do.
Hidden resources return 404, and visible-but-forbidden ones return 403.

## UI: shadcn/ui

The frontend is built on [shadcn/ui](https://ui.shadcn.com) (new-york style, Radix primitives, Tailwind CSS 4, React 19).

- **Components live in the repo** under `frontend/src/components/ui/` (button, card, dialog, sheet, dropdown-menu, select, command, popover, calendar, tabs, table, chart, sonner, tooltip, alert-dialog and more, sidebar). `components.json` is set up, so `npx shadcn@latest add <component>` drops new ones in alongside them.
- **Theme** is CSS variables in `frontend/src/index.css` (`:root` / `.dark`), with indigo as `--primary`. Change the brand colour in one place.
- **Dark mode**: light / dark / system from the account menu, saved per browser and applied before first paint.
- **Charts** use shadcn's `ChartContainer` over Recharts, with `--chart-1..5` colours checked for colour-blind separation and contrast in both themes. Every chart has a Chart/Table toggle.
- **App-level pieces** built from the primitives are in `frontend/src/components/common.tsx`: date picker, empty/error states, a `confirmAction()` AlertDialog (replaces `window.confirm`) and type-to-confirm for destructive deletes.
- **Layout**: collapsible shadcn Sidebar (icon rail on desktop with `Ctrl/⌘+B`, sheet on mobile), a `⌘K` command palette for pages and projects, task details in a Sheet, and assignee/label pickers built from Popover + Command.


## Architecture notes

- **Service modules in one deployable.** Each spec'd service (Auth, Project, Task, Sprint, Comment, File,
  Notification, WebSocket) is a self-contained module with its own router. They share one database and process,
  which keeps transactions simple. Any module can be split out later behind the same REST contract.
- **Real-time.** Socket.IO uses the Redis adapter, so events reach clients connected to any API instance.
  Clients join `user:`, `workspace:` and `project:` rooms (access-checked on join). The frontend patches
  React Query caches directly for instant board updates, then refetches in the background so filters stay right.
  Each event carries `actorId`, so the client skips its own echoes.
- **Ordering.** Cards have float positions; a move writes one row (the midpoint of its neighbours),
  and a column is re-spaced only when gaps get tiny.
- **Pagination.** Keyset cursors use the database's exact sort value (as text), so microsecond timestamps
  never cause skipped or duplicated rows.
- **Caching.** Dashboard keys embed a per-workspace version counter that every activity entry increments,
  so the cache is invalidated in O(1) with no key scans.
- **Files.** `STORAGE_DRIVER=s3` works with AWS S3, Cloudflare R2, Google Cloud Storage and other S3-compatible stores (its S3-interoperable API with HMAC keys).
  Downloads use short-lived presigned URLs. `local` stores files on disk and serves them via signed 5-minute links.
- **Auth.** 15-minute JWT access tokens; opaque refresh tokens stored only as hashes and rotated on every use
  (reuse is rejected). Google tokens are handed to the SPA in the URL fragment, never in a query string.

## API

The full OpenAPI 3.0 spec is in [`backend/openapi.yaml`](backend/openapi.yaml), with Swagger UI at `/api/docs`
and JSON at `/api/openapi.json`. A test fails if any Express route is missing from the spec.

## Tests

```bash
createdb pm_test            # once
npm test                    # 35 integration tests (needs Postgres; Redis at localhost:6379/1)
```
Coverage includes: auth and token rotation; RBAC at every role; invitation rules; task CRUD,
filters, cursor pagination and exact drag-and-drop ordering; subtasks; the sprint lifecycle,
burndown and velocity; comments, mentions and notifications; uploads, signed downloads and delete rights;
the activity log with filters and visibility; dashboard cache invalidation; deadline reminders
(sent once); per-project and sprint aggregate counts; Socket.IO auth and room isolation; and spec ↔ route parity.

## Configuration

See [`backend/.env.example`](backend/.env.example). In production you must set `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET`. For Google sign-in, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and add
`{API_URL}/api/v1/auth/google/callback` as an authorised redirect URI. The Google button appears automatically
once those are set. Set `VITE_API_URL` for the frontend build.
