# Stage 1: Install dependencies
FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/workflow/package.json packages/workflow/
COPY packages/sdk/package.json packages/sdk/
COPY packages/create-app/package.json packages/create-app/
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/workflow/node_modules ./packages/workflow/node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY . .
RUN pnpm --filter @flowscale/workflow build && pnpm --filter @flowscale/aios-web build

# Stage 3: Production runtime
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=14173
ENV HOSTNAME=0.0.0.0

RUN groupadd --system appuser && useradd --system --gid appuser appuser
RUN mkdir -p /home/appuser/.flowscale/aios /home/appuser/.flowscale/aios-outputs /home/appuser/.flowscale/apps \
    && chown -R appuser:appuser /home/appuser

# Copy standalone build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER appuser
ENV HOME=/home/appuser
EXPOSE 14173
CMD ["node", "apps/web/server.js"]
