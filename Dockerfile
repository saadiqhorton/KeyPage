FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM build AS deploy
RUN pnpm deploy --filter=@keypage/api --prod /out/api

FROM node:22-alpine AS runtime
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=deploy /out/api /app
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/data && chown node:node /app/data
# PORT default matches DEFAULT_LISTEN_PORT in packages/shared/src/app.ts
ENV KEYPAGE_DATA_DIR=/app/data \
    KEYPAGE_WEB_DIR=/app/apps/web/dist \
    PORT=9090 \
    HOST=0.0.0.0
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
