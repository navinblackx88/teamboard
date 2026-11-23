# Single-service image (Railway, Render, Fly…): the API serves the React app on one port ($PORT).
# Local multi-container demo uses docker-compose.yml instead.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY backend backend
COPY frontend frontend
# Same-origin API calls: the frontend talks to whatever host serves it.
ENV VITE_API_URL=""
RUN npm run build -w @teamboard/backend && npm run build -w @teamboard/frontend

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w @teamboard/backend && mkdir -p backend/node_modules

FROM node:22-alpine
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    STATIC_DIR=/app/frontend/dist \
    STORAGE_DRIVER=local \
    LOCAL_UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY backend/package.json backend/openapi.yaml ./backend/
COPY backend/drizzle ./backend/drizzle
COPY railway/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh
WORKDIR /app/backend
EXPOSE 4000
CMD ["start.sh"]
