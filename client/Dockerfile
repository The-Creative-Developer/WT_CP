# The public web server: Caddy serving the built SPA and proxying API traffic to the api container (PLAN §4,
# option B: one host, one origin). Built from the repo root, because the client needs the shared workspace:
#   docker build -f client/Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY runner/package.json runner/
COPY client/package.json client/
RUN npm ci --workspace client --ignore-scripts
COPY shared shared
COPY client client
# VITE_API_URL stays unset: the SPA calls /api, /socket.io and /yjs on its own origin.
RUN npm run build --workspace client

FROM caddy:2.10-alpine
COPY --from=build /app/client/dist /srv
# The Caddyfile is mounted by docker-compose.prod.yml, so routing can change without rebuilding the SPA.
