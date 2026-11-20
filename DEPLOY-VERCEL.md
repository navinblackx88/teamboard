# Deploying TeamBoard to Vercel

TeamBoard deploys to Vercel as **one project**. The React app is served as static files, and the Express API runs as a single Vercel Function at `/api/*` on the same domain. You don't need a separate API host, and CORS isn't involved.

The self-hosted setup (Docker / `npm run dev`) is unchanged; environment variables choose the deployment mode.

## What changes on Vercel

Vercel Functions don't keep long-lived processes or sockets, so the API switches to managed equivalents when it detects Vercel (`VERCEL=1`):

| Concern | Self-hosted | On Vercel |
|---|---|---|
| Real-time board, comments, notifications | Socket.IO (WebSockets) | **Pusher Channels** (`REALTIME_DRIVER=pusher`): private user/workspace channels, plus presence channels for the "viewing" avatars |
| Deadline reminders | `setInterval` every 15 min | **Vercel Cron** (`/api/cron/deadlines`) plus a *lazy tick*: incoming traffic runs the job if it's overdue, so reminders stay timely on the Hobby plan, where cron runs once a day |
| File uploads | Multipart through the API | **Browser → S3 presigned PUT** (`DIRECT_UPLOADS=true`), so files up to `MAX_UPLOAD_MB` aren't blocked by Vercel's 4.5 MB request-body limit |
| File storage | Local disk or S3 | **S3-compatible bucket**, required because function disks are ephemeral (AWS S3, Cloudflare R2, GCS interop) |
| Database | `pg` pool of 20 | Pool of 5 with `attachDatabasePool` (idle connections close before an instance suspends). Use a pooled URL (Neon, Supabase) |
| Migrations | On API start | **During the Vercel build**, using `DATABASE_URL_UNPOOLED` when available |

The rest of the app works as before:

- One handler (`api/index.ts`) serves every route.
- Swagger docs are at `/api/docs`.
- `/api/health` checks the database and Redis.
- The frontend reads its real-time and upload settings from `GET /api/v1/config` at runtime, so **no `VITE_*` variables are needed**.

## 1. Create the services

| Service | Needed | Suggested provider | Free tier |
|---|---|---|---|
| Postgres | Yes | **Neon** via the Vercel Marketplace (sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically) | Yes |
| Pusher Channels | Yes | pusher.com → create a *Channels* app and note its cluster (client events can stay off) | Sandbox plan |
| S3-compatible bucket | Yes | **Cloudflare R2** (no egress fees) or AWS S3 | R2: 10 GB |
| Redis | Optional | **Upstash** via the Vercel Marketplace (`REDIS_URL`, use the `rediss://` URL). Adds response caching and a cross-instance lock for jobs | Yes |
| SMTP | Optional | Resend, Postmark, SES… Without it, emails are logged instead | |

### Bucket CORS (required for browser uploads)

The browser uploads straight to the bucket, so the bucket must allow `PUT` from your domain.

**AWS S3**: Permissions → CORS:
```json
[{ "AllowedOrigins": ["https://your-app.vercel.app"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
```
**Cloudflare R2**: Settings → CORS policy, same rule. For R2, set:

- `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- `S3_REGION=auto`

Add preview domains (`https://*-your-team.vercel.app`) if you test uploads on preview deployments.

An upload that's started but never completed (say, the tab closes mid-upload) leaves an unattached object in the bucket. These are rare and harmless; clean them up periodically if storage cost matters.

## 2. Import the project

1. Push this repository to GitHub, GitLab or Bitbucket.
2. In Vercel: **Add New → Project**, then import the repo. Leave **Root Directory** as the repository root.
3. Framework preset: **Other**. `vercel.json` already sets the install command, build command, output directory, function config, rewrites and cron.
4. Add the environment variables below, then **Deploy**.

## 3. Environment variables

Copy `.env.vercel.example` for reference. Set these for **Production** (and Preview if you use it):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled Postgres URL (set by the Neon integration) |
| `DATABASE_URL_UNPOOLED` | Direct URL, used for migrations at build time (set by Neon) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Long random strings: `openssl rand -base64 48` |
| `REALTIME_DRIVER` | `pusher` |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | From your Pusher Channels app (cluster e.g. `ap2` for Mumbai) |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Your bucket and an access key limited to it |
| `S3_ENDPOINT` | Only for R2/GCS/MinIO |
| `DIRECT_UPLOADS` | `true` |
| `MAX_UPLOAD_MB` | `25` (any size; uploads skip the function) |
| `CRON_SECRET` | Random string. Vercel Cron sends it automatically; without it, cron calls are refused on Vercel |
| `REDIS_URL` | Optional (Upstash `rediss://…`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Authorised redirect URI: `https://<your-domain>/api/v1/auth/google/callback` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Optional |
| `APP_URL`, `API_URL` | Optional. They default to `https://$VERCEL_PROJECT_PRODUCTION_URL`. Set both to your custom domain once you add one |

Don't set `NODE_ENV`, because Vercel manages it. The install command uses `--include=dev`, so the build tools are present either way.

## 4. Seed demo data (optional)

Run this from your machine against the production database:

```bash
DATABASE_URL="<DATABASE_URL_UNPOOLED>" npm run seed -- --force
```

This creates the Acme demo workspace (`aisha@acme.dev`, `marco@acme.dev`, `priya@acme.dev`, `sam@acme.dev`; password `password123`). Don't do this on a database with real data, because `--force` wipes it.

## Plan notes

- **Hobby**:
  - Functions run up to 300 s on Fluid compute; this project sets `maxDuration: 60`.
  - Cron can only run **once a day**, so `vercel.json` schedules deadlines daily at 07:00 UTC. The lazy tick covers the rest while people use the app.
- **Pro**: change the cron schedule to `*/15 * * * *` for reminders that fire even when nobody is online.
- **Request bodies**: capped at 4.5 MB by Vercel. Everything except uploads is tiny; uploads bypass the function with `DIRECT_UPLOADS=true`. If you leave direct uploads off, the API caps uploads at 4 MB on Vercel and the UI shows that limit.
- **Pusher messages**: capped at 10 KB. Larger events are trimmed to ids, and clients refetch, so nothing is lost.

## Checking a build locally

```bash
npx vercel build      # produces .vercel/output exactly as Vercel would deploy it
npx vercel dev        # runs the app + function locally (needs `vercel link`)
```

Any Pusher-protocol server works in development, e.g. [soketi](https://soketi.app):

- `PUSHER_HOST=localhost`
- `PUSHER_PORT=6001`
- `PUSHER_USE_TLS=false`

## Troubleshooting

| Symptom | Cause |
|---|---|
| Build fails with "Local file storage doesn't persist…" | Set `STORAGE_DRIVER=s3` and the S3 variables |
| Build fails with "REALTIME_DRIVER=pusher needs…" | Pusher variables missing for that environment (Production vs Preview) |
| Uploads fail with a CORS error in the browser console | Bucket CORS doesn't allow `PUT` from your domain |
| "Live" badge stays grey | Wrong `PUSHER_CLUSTER`, or the key doesn't match the app |
| `GET /api/cron/deadlines` returns 403 | `CRON_SECRET` isn't set. Vercel Cron only adds the header when it is |
| Too many database connections | Use the pooled `DATABASE_URL`, or lower `DB_POOL_MAX` |
