# Build from the repository root so the shared permission presets are available:
#   docker build -f whatsapp-service/Dockerfile -t dt-whatsapp .
FROM node:22-slim AS build
WORKDIR /app
COPY whatsapp-service/package.json whatsapp-service/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY whatsapp-service/tsconfig.json ./
COPY whatsapp-service/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY whatsapp-service/package.json ./
COPY src/lib/permission-presets.json ./permission-presets.json
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
