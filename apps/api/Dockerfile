FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY apps/api/src/main.mjs ./apps/api/src/main.mjs
COPY apps/api/src/server.mjs ./apps/api/src/server.mjs
RUN mkdir -p integrations/whoop/server
COPY integrations/whoop/server/config.mjs ./integrations/whoop/server/config.mjs
COPY integrations/whoop/server/encrypted-token-store.mjs ./integrations/whoop/server/encrypted-token-store.mjs
COPY integrations/whoop/server/oauth-state.mjs ./integrations/whoop/server/oauth-state.mjs
COPY integrations/whoop/server/service.mjs ./integrations/whoop/server/service.mjs
COPY integrations/whoop/server/snapshot-cache.mjs ./integrations/whoop/server/snapshot-cache.mjs
COPY integrations/whoop/server/whoop-client.mjs ./integrations/whoop/server/whoop-client.mjs

USER node
EXPOSE 4001
CMD ["node", "apps/api/src/main.mjs"]