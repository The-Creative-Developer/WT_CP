# The API image. Built from the repo root, because the server needs the shared workspace:
#   docker build -f server/Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Every workspace's package.json, so npm ci sees the same workspaces as the lockfile.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY runner/package.json runner/
COPY client/package.json client/
# --ignore-scripts skips the root `prepare` (husky, a dev tool) and mongodb-memory-server's binary download.
RUN npm ci --workspace server --ignore-scripts
COPY shared shared
COPY server server
RUN npm run build --workspace server

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY runner/package.json runner/
COPY client/package.json client/
# Production dependencies only. argon2 ships prebuilt binaries for Linux, so no compiler is needed.
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
# Not root: the API faces the internet and needs no special permissions.
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
