# The game server (packages/server) and the content it needs. The web client is
# a static build deployed separately (docs/deploy.md).
FROM node:22-slim

ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
# tsx is a devDependency of the server (the packages are TypeScript sources), so no --prod.
RUN pnpm install --frozen-lockfile --filter @fishingjamboree/server... --prod=false

COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/server packages/server
COPY content content

# Saved rooms live here: mount a volume on /data/rooms (they hold seat tokens).
RUN mkdir -p /data/rooms && chown -R node:node /data
ENV PORT=8787 CONTENT_DIR=/app/content ROOMS_DIR=/data/rooms
VOLUME /data/rooms
USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# node directly (not pnpm or sh), so SIGTERM reaches the server and it shuts down cleanly.
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/main.ts"]
