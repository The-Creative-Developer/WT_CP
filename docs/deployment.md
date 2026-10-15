# Deployment

DevVerse runs on one VM, using PLAN §4's **option B**: Caddy serves the single-page app and the API on a single
HTTPS host. The host name comes free from [sslip.io](https://sslip.io), which turns an IP inside the name into DNS
(`devverse.203-0-113-7.sslip.io` → `203.0.113.7`). Everything is on one origin, so the refresh cookie and WebSockets
need no CORS set-up.

```
Internet ──443──▶ web (Caddy: HTTPS, SPA, reverse proxy) ──▶ api (Express, Socket.IO, Yjs) ──▶ MongoDB Atlas
                                                               │ internal network only
                                                               ▼
                                                     runner ──docker.sock──▶ sandbox containers
```

| Container | Image                                   | Notes                                                                                                             |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `web`     | `client/Dockerfile` (Caddy + built SPA) | The only one with published ports (80, 443). Routing is in `deploy/Caddyfile`.                                    |
| `api`     | `server/Dockerfile`                     | Runs as the unprivileged `node` user. On the `public` network (Caddy, Atlas) and the `internal` one (runner).     |
| `runner`  | `runner/Dockerfile`                     | Gets the host's Docker socket to start sandboxes. Only on the `internal` network: no published port, no internet. |

Everything is defined in `docker-compose.prod.yml`. Settings and secrets live in `deploy/.env` on the VM, which is
gitignored.

## 1. Create the VM

On DigitalOcean (paid from the Student Pack credit), create a Droplet:

- **Image:** Marketplace → **Docker on Ubuntu 24.04**.
- **Size:** Basic, Regular, **2 vCPU / 4 GB**.
- **Region:** the one closest to the team.
- **Authentication:** **SSH key** (not a password).

Note the Droplet's public IP, for example `203.0.113.7`.

### Firewall

Create a **Cloud Firewall** (Networking → Firewalls) and apply it to the Droplet. Inbound rules:

| Type   | Protocol | Port | Sources                                                        |
| ------ | -------- | ---- | -------------------------------------------------------------- |
| SSH    | TCP      | 22   | your own IP addresses only                                     |
| HTTP   | TCP      | 80   | all (Let's Encrypt checks it, and Caddy redirects it to HTTPS) |
| HTTPS  | TCP      | 443  | all                                                            |
| Custom | UDP      | 443  | all (HTTP/3)                                                   |

Use the Cloud Firewall rather than `ufw`: Docker writes its own iptables rules for published ports, which bypass
`ufw`. The Docker Marketplace image also opens 2375/2376 in `ufw` for the Docker API. Nothing listens on those ports,
but remove the rules anyway: `ufw delete allow 2375/tcp && ufw delete allow 2376/tcp`.

TURN for video calls (3478 and the relay range) is added in Week 3.

## 2. Create the database

On [MongoDB Atlas](https://cloud.mongodb.com):

1. Create a free **M0** cluster in the region closest to the Droplet. Atlas clusters are replica sets, so the
   transactions DevVerse uses work.
2. **Database Access:** add a user, for example `devverse`, with a generated password and the **Read and write to
   any database** role.
3. **Network Access:** add the Droplet's IP. Don't use `0.0.0.0/0`.
4. **Connect → Drivers:** copy the `mongodb+srv://…` string and put the database name before the `?`:
   `mongodb+srv://devverse:<password>@<cluster>.mongodb.net/devverse?retryWrites=true&w=majority`

## 3. First deploy

SSH in (`ssh root@203.0.113.7`) and run:

```bash
# The code (the repository is public, so no credentials are needed).
git clone https://github.com/The-Creative-Developer/WT_CP.git /opt/devverse
cd /opt/devverse

# The sandbox images that user code runs in (~5 minutes; C++ and Java are the big ones).
sh runner/sandboxes/build.sh

# Where the runner writes each program before mounting it into a sandbox.
mkdir -p /var/lib/devverse/runs

# Settings and secrets.
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

In `deploy/.env`, set:

- `PUBLIC_URL`: `https://devverse.<ip with dashes>.sslip.io`, for example `https://devverse.203-0-113-7.sslip.io`.
- `MONGODB_URI`: the Atlas string from step 2.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `RUNNER_TOKEN`: three different values, each from
  `openssl rand -base64 48`.

Then build and start everything. The first build takes a few minutes:

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
```

Caddy gets a Let's Encrypt certificate within a minute or so. Check it with:

```bash
curl https://devverse.203-0-113-7.sslip.io/healthz
# {"status":"ok","db":"connected",...}
```

Then open the site, sign up, create a room, open it in a second browser and press Run.

## 4. Updating

```bash
cd /opt/devverse
git pull
docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
docker image prune -f   # drop the previous builds
```

Only containers whose image changed restart. The certificate is kept in the `caddy-data` volume, so rebuilds don't
request a new one; Let's Encrypt limits how many it issues. After changing `runner/sandboxes/`, rebuild the sandbox
images with `sh runner/sandboxes/build.sh`.

## Troubleshooting

| Symptom                     | Check                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No HTTPS certificate        | `docker compose -f docker-compose.prod.yml logs web`. Ports 80 and 443 must be open in the Cloud Firewall, and `PUBLIC_URL` must contain the Droplet's own IP.                                                                                             |
| 502 Bad Gateway             | The API isn't healthy: `docker compose -f docker-compose.prod.yml logs api`. A bad `MONGODB_URI`, or the IP missing from Atlas's Network Access, are the usual causes.                                                                                     |
| The server refuses to start | `logs api` lists the setting that is missing or invalid.                                                                                                                                                                                                   |
| Runs fail                   | Run `docker compose -f docker-compose.prod.yml exec api node -e "fetch('http://runner:5050/healthz').then(r => r.text()).then(console.log)"`. It lists the sandbox images the runner can see. Build any that are missing with `runner/sandboxes/build.sh`. |
| Status of everything        | `docker compose -f docker-compose.prod.yml ps`                                                                                                                                                                                                             |

## Security notes

- **Docker socket:** only `runner` gets `/var/run/docker.sock`, which is equivalent to root on the host (ADR 005). It
  has no published port, and its network has no internet route, so only the API can reach it. The API itself runs as
  a non-root user and has no Docker access.
- **Secrets** exist only in `deploy/.env` on the VM, with mode 600. Each container receives only the variables it
  needs: the runner never sees the database address or the JWT secrets.
- **No access logs** in Caddy: the Yjs WebSocket URL carries the access token in its query string.
- **Headers:** Caddy adds HSTS, `nosniff` and a referrer policy to every response, and Helmet adds a CSP to API
  responses. A CSP for the SPA itself is in Week 4's security pass (PLAN §9, day 24).

## Rehearsing locally

The same stack runs on a laptop with Docker, to check changes to the Dockerfiles or the Caddyfile. Use a settings
file with `PUBLIC_URL=http://localhost` (plain HTTP, so no certificate is needed), the local MongoDB
(`MONGODB_URI=mongodb://host.docker.internal:27017/devverse-rehearsal?replicaSet=rs0&directConnection=true`, after
`npm run db:up`), and on macOS a `RUNS_DIR` that Docker Desktop shares, such as `/private/tmp/devverse-runs`. Then
`docker compose -f docker-compose.prod.yml --env-file <that file> up -d --build` and open http://localhost.
