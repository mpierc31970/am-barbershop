# syntax=docker/dockerfile:1
# CDS Platform web app: multi-stage Next.js standalone image (PLAT-04).
# Shape follows DCR-Website's Dockerfile, adapted to the monorepo paths.
# No secrets are passed as ARG/ENV here; runtime config comes from Coolify env vars.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Dependencies. Every workspace package.json must be listed, or npm ci fails
# with a lockfile mismatch.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
# apps/failsafe has no dependencies and is not built here (it runs on the third VPS, D291);
# its manifest is listed only so npm ci matches the lockfile.
COPY apps/failsafe/package.json apps/failsafe/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/templates/package.json packages/templates/
COPY packages/addon-registry/package.json packages/addon-registry/
# One COPY line per add-on: packages/addons/<slug>/package.json (tests/structure.test.ts).
COPY packages/addons/testimonials/package.json packages/addons/testimonials/
COPY packages/addons/credentials/package.json packages/addons/credentials/
COPY packages/addons/builder-pro/package.json packages/addons/builder-pro/
COPY packages/addons/studio-booking/package.json packages/addons/studio-booking/
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone APP_VERSION=$APP_VERSION
# The workspace build skips the root prebuild, so check the add-on barrels here: the image
# must match packages/addons and docs/how-to on disk, exactly as CI tested (B-CR-02). The
# compiled policy texts must match their markdown the same way (09-05, legal:check).
RUN npm run addons:check && npm run legal:check && npm run build -w @cds/web

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
# video compression (07-13, D220): ffmpeg + ffprobe from Alpine, never an npm binary (CONTEXT decision 3)
# 07-30: fontconfig + ttf-dejavu so sharp/librsvg can draw the wordmark site icon text.
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu
# A&M: the local-disk ObjectStore (published pages, media) lives on the /data volume
# (Coolify persistent storage), owned by nextjs so the app can write to it. Without a
# volume it would vanish on every redeploy.
ENV CDS_STORAGE_DIR=/data/storage CDS_PUBLIC_STORAGE_DIR=/data/storage-public
RUN mkdir -p /data/storage /data/storage-public && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
