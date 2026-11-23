# Build from the repository root (npm workspaces share one lockfile):
#   docker build -f backend/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w @teamboard/backend && mkdir -p backend/node_modules

FROM deps AS build
COPY backend/tsconfig.json backend/drizzle.config.ts backend/
COPY backend/src backend/src
RUN npm run build -w @teamboard/backend

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w @teamboard/backend && mkdir -p backend/node_modules

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json backend/openapi.yaml ./backend/
COPY backend/drizzle ./backend/drizzle
RUN mkdir -p /app/backend/uploads && chown node:node /app/backend/uploads
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD wget -qO- http://localhost:4000/health || exit 1
# Migrations run on start. With SEED_DEMO_DATA=true the demo workspace is created on first start
# (the seed skips itself once the database has users).
CMD ["sh", "-c", "if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node dist/db/seed.js; fi && exec node dist/index.js"]
