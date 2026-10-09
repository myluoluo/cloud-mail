FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app/mail-worker
COPY mail-worker/package.json mail-worker/pnpm-lock.yaml mail-worker/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
WORKDIR /app/mail-vue
COPY mail-vue/package.json mail-vue/pnpm-lock.yaml mail-vue/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
WORKDIR /app
COPY mail-worker/src mail-worker/src
COPY mail-vue mail-vue
COPY docker docker
RUN mkdir -p /app/mail-worker/dist
ENV WRANGLER_SEND_METRICS=false
