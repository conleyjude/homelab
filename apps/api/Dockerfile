FROM node:22-alpine AS dashboard-build

WORKDIR /workspace
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./apps/dashboard/
RUN npm --prefix apps/dashboard ci
COPY apps/dashboard ./apps/dashboard
COPY integrations/whoop/dashboard ./integrations/whoop/dashboard
COPY integrations/weather/dashboard ./integrations/weather/dashboard
RUN npm --prefix apps/dashboard run build

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY apps/api/src/main.mjs ./apps/api/src/main.mjs
COPY apps/api/src/server.mjs ./apps/api/src/server.mjs
RUN mkdir -p integrations/whoop/server
RUN mkdir -p integrations/weather/server
COPY integrations/whoop/server/config.mjs ./integrations/whoop/server/config.mjs
COPY integrations/whoop/server/encrypted-token-store.mjs ./integrations/whoop/server/encrypted-token-store.mjs
COPY integrations/whoop/server/oauth-state.mjs ./integrations/whoop/server/oauth-state.mjs
COPY integrations/whoop/server/service.mjs ./integrations/whoop/server/service.mjs
COPY integrations/whoop/server/snapshot-cache.mjs ./integrations/whoop/server/snapshot-cache.mjs
COPY integrations/whoop/server/whoop-client.mjs ./integrations/whoop/server/whoop-client.mjs
COPY integrations/weather/server/config.mjs ./integrations/weather/server/config.mjs
COPY integrations/weather/server/open-meteo.mjs ./integrations/weather/server/open-meteo.mjs
COPY integrations/weather/server/service.mjs ./integrations/weather/server/service.mjs
COPY --from=dashboard-build /workspace/apps/dashboard/dist ./apps/api/public

USER node
EXPOSE 4001
CMD ["node", "apps/api/src/main.mjs"]