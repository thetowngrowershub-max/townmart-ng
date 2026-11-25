# syntax=docker/dockerfile:1.7
# Multi-stage build for the TownMart web app and worker.
#   dev     — used by docker-compose.yml (source mounted, hot reload)
#   web     — production Next.js standalone server
#   worker  — production BullMQ worker
# docker-compose.prod.yml builds web, worker and build (the migrate tool).

ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev", "--hostname", "0.0.0.0"]

FROM deps AS build
# Values Next.js reads at build time (the image host for next/image and the
# Turnstile site key, which ends up in browser code). Nothing secret goes here.
ARG S3_PUBLIC_BASE_URL=""
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV S3_PUBLIC_BASE_URL=$S3_PUBLIC_BASE_URL NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM build AS worker
ENV NODE_ENV=production SERVICE_NAME=townmart-worker
RUN groupadd --system app && useradd --system --gid app app
USER app
CMD ["pnpm", "worker"]
