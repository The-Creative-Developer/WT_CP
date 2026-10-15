# The code runner image. Built from the repo root, because the runner needs the shared workspace:
#   docker build -f runner/Dockerfile .

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY runner/package.json runner/
COPY client/package.json client/
RUN npm ci --workspace runner --ignore-scripts
COPY shared shared
COPY runner runner
RUN npm run build --workspace runner

FROM node:24-alpine
ENV NODE_ENV=production
# The runner starts sandbox containers with the docker CLI, talking to the host's Docker through its socket.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
# tsup bundles everything the runner needs (it has no runtime dependencies), so dist is all there is.
COPY --from=build /app/runner/dist dist
# Runs as root on purpose: using the Docker socket needs it, and the socket already gives root-level control of the
# host. That is why only this container gets the socket, it has no published port, and only the API can reach it
# (ADR 005, docs/deployment.md).
EXPOSE 5050
CMD ["node", "dist/index.js"]
