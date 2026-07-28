# The web app, as a self-contained image.
#
# Three stages so the thing that gets shipped contains no package manager, no
# source, and no build cache: only the traced server bundle Next produced and
# the Node runtime it needs.
#
# Build from the repository root, not from this directory, because the app
# depends on two workspace packages and on the root lockfile:
#
#     docker build -f apps/web/Dockerfile -t nidhi-web .

# --- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable

# Only the manifests, so this layer is reused on every build that does not
# change a dependency. The install is by far the slowest step.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY db/package.json db/
RUN pnpm install --frozen-lockfile

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /repo/db/node_modules ./db/node_modules
COPY . .

# NEXT_PUBLIC_* values are compiled into the client bundle, so the public site
# URL has to be known at build time and cannot be supplied at run time. The
# default is a placeholder: a real deployment passes --build-arg.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1

# The build renders no page that needs the database: every route that reads one
# is dynamic, and the four share-card routes fall back to an empty card when it
# is unreachable. So no database is required here, deliberately.
RUN pnpm --filter @nidhi/web build

# --- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Not root. The app writes nothing to its own filesystem.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# The standalone output already contains the traced subset of node_modules and
# a server.js entry point. static/ is not traced into it and has to be copied
# alongside, or every stylesheet and script 404s. There is no public/ directory:
# this app serves no static files of its own, and the share-card fonts are
# traced in through outputFileTracingIncludes in next.config.ts.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

# Ops needs to distinguish "container up" from "app serving with a reachable
# database", and /api/health is the endpoint that already knows the difference
# (docs/09 plane B). A degraded database makes this unhealthy on purpose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
