# Deploying TeamBoard to Railway

TeamBoard runs on Railway as **one service** plus Railway's managed **PostgreSQL**. The container serves the React app and the API on the same domain, so there's no CORS setup. Socket.IO (WebSockets), background jobs and file storage all work exactly as in the local Docker demo, because Railway keeps the process running. Redis and an S3 bucket are optional, only needed to run more than one instance.

```
Browser ── https://<app>.up.railway.app ──▶  teamboard service  (Dockerfile, one process, $PORT)
                                              ├─ React app (static, from the image)
                                              ├─ REST API + /api/docs + Socket.IO (WebSockets)
                                              ├─ background jobs (in-process)
                                              ├─ task attachments ──▶ Volume  /data
                                              └─ SQL ──────────▶ Railway PostgreSQL
```

The repo already contains everything Railway reads:

| File | Purpose |
|---|---|
| `railway.json` | Build with `Dockerfile`, health check on `/health`, restart on failure |
| `Dockerfile` | Builds API + frontend into one image; runs as the unprivileged `node` user |
| `railway/start.sh` | Makes the volume writable, seeds demo data once (optional), starts the API (migrations run on start) |

## 1. Create the project

1. Push this folder to its own GitHub repository. (If it's part of a larger repo, set the service's **Root Directory** to this folder.)
2. In Railway: **New Project → Deploy from GitHub repo** and pick the repo. Railway finds `railway.json` and builds the `Dockerfile`. The first deploy will fail until steps 2–4 are done, which is expected.
3. In the same project: **+ Create → Database → PostgreSQL**.

## 2. Variables

Open the teamboard service → **Variables** and add:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Type exactly this; Railway links it to the database over the private network |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` | Signs access tokens |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 48` (a different value) | Signs refresh tokens |
| `SEED_DEMO_DATA` | `true` | Optional: creates demo users and data on first start (skipped once users exist). Omit for an empty install |

You don't need to set storage variables: the image defaults to `STORAGE_DRIVER=local` with `LOCAL_UPLOAD_DIR=/data/uploads` (the volume from step 3). Railway provides `PORT` and the app listens on it.

## 3. Volume (persistent task attachments)

Right-click the teamboard service (or **⌘K → Volume**) → **Attach volume**, mount path **`/data`**. Without a volume, uploaded task attachments are lost on every redeploy.

## 4. Public domain

Service → **Settings → Networking → Generate Domain**. If Railway asks for a port, use the one it detects (the app listens on `$PORT`). `APP_URL` and `API_URL` default to this domain automatically (`RAILWAY_PUBLIC_DOMAIN`), so email links and CORS are correct.

Using a **custom domain**? Set `APP_URL` and `API_URL` to `https://your-domain` as well.

Railway redeploys after variable changes. Open the domain and sign in with `aisha@acme.dev` (admin), `marco@acme.dev` (PM), `priya@acme.dev` (developer), `sam@acme.dev` (viewer), password `password123` (when `SEED_DEMO_DATA=true`). **Change these passwords, or deploy without demo data, before sharing the URL.**

## Optional

| Variable | Enables |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Real email (Resend, Postmark, SES, Brevo…). Without SMTP, emails are written to the deploy logs instead of sent. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (redirect URI `https://<your-domain>/api/v1/auth/google/callback`) |

## Operations

| Task | How |
|---|---|
| Logs | Service → **Deployments → View logs** (or `railway logs`) |
| Reseed from scratch | `railway ssh` into the service, then `node dist/db/seed.js --force` (wipes and reseeds) |
| SQL shell | Postgres service → **Data**, or `railway connect Postgres` |
| Backups | Postgres service → **Backups**; the volume has its own backups under the volume's settings |
| Health | `GET /health` reports database and Redis status; Railway uses it to gate each deploy |

## Scaling beyond one instance

The volume ties the service to **one replica**, which is plenty for an MVP. To run several:

1. Add **Redis** (**+ Create → Database → Redis**) and set `REDIS_URL=${{Redis.REDIS_URL}}`. Live updates and rate limits then work across instances.
2. Move files to an S3-compatible bucket: set `STORAGE_DRIVER=s3` plus the `S3_*` variables (see `.env.example`) and detach the volume.
3. Raise `numReplicas` in `railway.json`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Set JWT_… in production` | Add the JWT variables from step 2 |
| `ECONNREFUSED` / `getaddrinfo` for the database | `DATABASE_URL` missing or not `${{Postgres.DATABASE_URL}}` |
| Health check times out on first deploy | Check the logs. Migrations and the seed run before the server listens; the timeout is 180 s |
| `EACCES` writing uploads | Volume not mounted at `/data`, or `LOCAL_UPLOAD_DIR` overridden |
| Login works but links in emails point to the wrong host | Custom domain: set `APP_URL` / `API_URL` |
| 401 on everything after changing JWT secrets | Expected: everyone has to sign in again |
