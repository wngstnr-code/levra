# syntax=docker/dockerfile:1.7
# One image for every backend service (api, indexer, keeper, agent, migrate). Build from the repo root:
#   docker build -f deploy/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short=12 HEAD) .
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile \
      --filter "@levra/api..." --filter "@levra/indexer..." --filter "@levra/keeper..." --filter "@levra/db..." --filter "@levra/agent..." --filter "@levra/tapeout..."

FROM node:24-bookworm-slim AS runtime
ARG APP_VERSION=local
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY deploy/entrypoint.sh /usr/local/bin/levra-entrypoint
RUN chmod 0755 /usr/local/bin/levra-entrypoint
USER node
ENTRYPOINT ["/usr/local/bin/levra-entrypoint"]
