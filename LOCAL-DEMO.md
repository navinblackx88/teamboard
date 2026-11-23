# TeamBoard: local MVP demo

TeamBoard runs on one machine with Docker. It needs no cloud accounts and no API keys: after the first image build, it runs entirely offline.

```bash
docker compose up --build        # first run builds the images (a few minutes)
```

Then open **http://localhost:8080**.

| What | Where |
|---|---|
| App | http://localhost:8080 |
| API docs (Swagger) | http://localhost:8080/api/docs |
| Email inbox (Mailpit) | http://localhost:8025 |

**Demo logins** (password `password123`):

| Email | Role | What they can do |
|---|---|---|
| `aisha@acme.dev` | Admin | Everything, including members and workspace settings |
| `marco@acme.dev` | Project Manager | Projects, sprints, labels |
| `priya@acme.dev` | Developer | Tasks, comments, files |
| `sam@acme.dev` | Viewer | Read-only |

## Architecture

```
Browser ──▶ :8080  web (nginx)
                    ├─ /             React SPA (static build)
                    ├─ /api/*        ─┐
                    └─ /socket.io/*  ─┴─▶ api (Node 22 · Express · Socket.IO)
                                              ├─▶ postgres (data)
                                              ├─▶ volume "uploads" (attachments)
                                              └─▶ mailpit (SMTP → inbox at :8025)
```

| Container | Role | Data |
|---|---|---|
| `web` | nginx: serves the built React app and reverse-proxies the API and WebSockets on the same origin | — |
| `api` | REST API (`/api/v1`), Socket.IO real-time, JWT auth with role-based access, the deadline-reminder job | `uploads` volume |
| `postgres` | System of record. Migrations run automatically when the API starts | `pgdata` volume |
| `mailpit` | Catches every outgoing email (assignments, @mentions, deadlines, invites), so you can show them without a mail provider | — |

### Design decisions for the MVP

- **Single origin.** nginx serves the app and proxies `/api` and `/socket.io`, so the browser talks to one host and port. No CORS configuration, nothing to change if you move ports, and it matches how a production reverse proxy would be set up.
- **No Redis.** With one API instance, the cache and job lock fall back to process memory. Redis only matters once you run several API instances (`REDIS_URL` turns it on; Socket.IO then uses its Redis adapter).
- **No object storage.** Attachments are written to a Docker volume. `STORAGE_DRIVER=s3` switches to S3 or R2 later with no code change.
- **Mail is local.** Notification emails go to Mailpit, which is part of the demo rather than a dependency.
- **Optional integrations stay off.** Google sign-in only appears when `GOOGLE_CLIENT_ID` is set. The Vercel code paths (Pusher, presigned uploads, cron routes) are inactive unless explicitly configured.
- **Zero setup.** Migrations run on start, and `SEED_DEMO_DATA=true` (the default) creates the Acme demo workspace on the first start only. The seed skips itself once users exist.
- **Ports.** Only 8080 (app) and 8025 (inbox) are published. Postgres stays inside the Docker network, so it can't clash with a database already on your machine.

### Scaling path (beyond the MVP)

| Need | Change |
|---|---|
| Several API instances | Add Redis (`REDIS_URL`), scale `api`, put nginx or a load balancer in front |
| Durable shared files | `STORAGE_DRIVER=s3` with S3, R2, or a self-hosted S3-compatible store |
| Real email | Point `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` at your provider |
| Serverless hosting | See `DEPLOY-VERCEL.md` |

## A 10-minute demo script

1. **Dashboard.** Sign in as **Marco** (PM). Show the stat cards, sprint progress, upcoming deadlines and activity feed.
2. **Board and real time.**
   - Open *Customer Portal* and drag a card from *In Progress* to *Review*.
   - In a second browser window (or a private window), sign in as **Priya** on the same board. The card moves there instantly, and the avatars in the header show who's viewing.
3. **Task detail.**
   - Open *Stripe payment intent flow*. Edit fields inline and add a subtask.
   - Attach a file (Files tab).
   - Post a comment that @mentions Priya.
4. **Notifications.**
   - Priya gets a toast and a badge on the bell.
   - Open **http://localhost:8025** to show the matching email in Mailpit.
5. **Sprints.** Open *Sprints*: drag a backlog task into the planned sprint, then switch to **Reports** for the burndown and velocity charts (each has a table view).
6. **Roles.** Sign in as **Sam** (Viewer). No create buttons, cards can't be dragged, and the API refuses writes with 403.
7. **Extras.** Press `⌘K` / `Ctrl+K` for the command palette, switch to dark mode from the account menu, and open the Activity log with its filters.

## Operating it

| Task | Command |
|---|---|
| Start (after the first build) | `docker compose up -d` |
| Follow API logs | `docker compose logs -f api` |
| Stop (keep data) | `docker compose down` |
| Reset to fresh demo data | `docker compose down -v && docker compose up -d` |
| Start with an empty install | `SEED_DEMO_DATA=false docker compose up -d` (after `down -v`) |
| Rebuild after code changes | `docker compose up --build -d` |
| Open a database shell | `docker compose exec postgres psql -U pm` |

For anything beyond a demo on your own machine, set real secrets:

```bash
JWT_ACCESS_SECRET=$(openssl rand -base64 48) JWT_REFRESH_SECRET=$(openssl rand -base64 48) docker compose up -d
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` on 8080 or 8025 | Something else uses the port. Change the left side of `ports:` in `docker-compose.yml` (e.g. `"9090:80"`) and set `APP_URL`/`API_URL` to match |
| `web` waits a long time on first start | It waits for the API health check; the first start runs migrations and seeding. Check `docker compose logs api` |
| Login fails with seeded accounts | The volume already had data from an earlier run. Run `docker compose down -v`, then start again |
| Images fail to pull | Docker needs internet access the first time, to download `postgres`, `node`, `nginx` and `mailpit` |
| Real-time "Live" badge is grey | Hard-refresh the page. If it persists, check `docker compose logs web` for proxy errors |
