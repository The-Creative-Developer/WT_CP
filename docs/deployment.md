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

Internet ──3478, 49160-49200──▶ turn (coturn: relays call media when browsers can't connect directly)
```

| Container | Image                                   | Notes                                                                                                                 |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `web`     | `client/Dockerfile` (Caddy + built SPA) | The only one with published ports (80, 443). Routing is in `deploy/Caddyfile`.                                        |
| `api`     | `server/Dockerfile`                     | Runs as the unprivileged `node` user. On the `public` network (Caddy, Atlas) and the `internal` one (runner).         |
| `runner`  | `runner/Dockerfile`                     | Gets the host's Docker socket to start sandboxes. Only on the `internal` network: no published port, no internet.     |
| `turn`    | `coturn/coturn:4.18.0`                  | TURN relay for calls, on the host's network (3478 UDP/TCP, relays on UDP 49160–49200). Credentials come from the API. |

Everything is defined in `docker-compose.prod.yml`. Settings and secrets live in `deploy/.env` on the VM, which is
gitignored.

## 1. Create the VM

DevVerse runs on **Azure for Students** ($100 of credit a year, no card needed). DigitalOcean, which PLAN §4
originally named, no longer gives student credits. Any Ubuntu VM with Docker works the same way; only this section is
provider-specific.

In the [Azure portal](https://portal.azure.com), create a **Virtual machine**:

- **Region:** one of the regions your student subscription allows (Azure Portal → Policy → "Allowed resource
  deployment regions"). Don't pick an availability zone; zones can block student subscriptions.
- **Image:** Ubuntu Server 24.04 LTS (x64).
- **Size:** **B2als_v2** (2 vCPU / 4 GB, AMD), or **B2s** if your subscription doesn't offer it. The free-tier sizes
  (B1s, B2ats v2, B2pts v2) have only 1 GB of RAM, too little for the API, the runner, sandboxes and image builds.
- **Authentication:** **SSH public key**. Keep the downloaded `.pem` file private (`chmod 400`).
- **Public IP:** keep it **Static** (Standard SKU), so the address, and the site's sslip.io name with it, survives
  stopping and starting the VM.

Then install Docker (Engine + Compose plugin) following
[Docker's Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), and add your user to the `docker`
group (`sudo usermod -aG docker $USER`, then log in again).

Note the VM's public IP, for example `203.0.113.7`.

Stopping the VM in the portal (deallocating it) stops the compute charges, which makes the credit last longer. The
site is down while it's stopped.

### Firewall

Azure's firewall is the VM's **Network Security Group**: VM → **Networking** → **Network settings** → **Create port
rule** → **Inbound port rule**. Add:

| Service | Protocol | Port        | Source                                                         |
| ------- | -------- | ----------- | -------------------------------------------------------------- |
| SSH     | TCP      | 22          | **My IP address** only                                         |
| HTTP    | TCP      | 80          | Any (Let's Encrypt checks it, and Caddy redirects it to HTTPS) |
| HTTPS   | TCP      | 443         | Any                                                            |
| Custom  | UDP      | 443         | Any (HTTP/3)                                                   |
| TURN    | UDP      | 3478        | Any                                                            |
| TURN    | TCP      | 3478        | Any (for networks that block UDP)                              |
| Relay   | UDP      | 49160-49200 | Any (one port per relayed stream)                              |

Azure filters traffic before it reaches the VM, so `ufw` isn't needed. (On a VPS without a provider firewall, note
that Docker writes its own iptables rules for published ports, which bypass `ufw`.) If you connect from a new network,
update the SSH rule's source to your new IP.

## 2. Create the database

On [MongoDB Atlas](https://cloud.mongodb.com):

1. Create a free **M0** cluster close to the VM (not to you): the API talks to the database on every request. For a
   VM in Azure East Asia, use Azure Hong Kong, AWS Hong Kong or AWS Singapore. Atlas clusters are replica sets, so the
   transactions DevVerse uses work.
2. **Database Access:** add a user, for example `devverse`, with a generated password and the **Read and write to
   any database** role. If you let Atlas's "Automate security setup" create the user, it picks the name itself (e.g.
   `<name>_db_user`): check it under Security → Database Access and use that exact name in the string.
3. **Network Access:** add the VM's IP. Don't use `0.0.0.0/0`.
4. **Connect → Drivers:** copy the `mongodb+srv://…` string and put the database name before the `?`:
   `mongodb+srv://devverse:<password>@<cluster>.mongodb.net/devverse?retryWrites=true&w=majority`

## 3. First deploy

SSH in (`ssh -i path/to/key.pem <user>@203.0.113.7`) and run:

```bash
# 2 GB of swap. Small Azure sizes have no swap (and B2als_v2 has no temporary disk); it keeps image builds and busy
# sandboxes from running out of memory.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# The code (the repository is public, so no credentials are needed).
sudo git clone https://github.com/The-Creative-Developer/WT_CP.git /opt/devverse
sudo chown -R "$USER": /opt/devverse
cd /opt/devverse

# The sandbox images that user code runs in (~5–10 minutes; C++ and Java are the big ones).
sh runner/sandboxes/build.sh

# Where the runner writes each program before mounting it into a sandbox.
sudo mkdir -p /var/lib/devverse/runs

# Settings: the site address and three random secrets, generated on the VM so they never leave it.
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://devverse.203-0-113-7.sslip.io|' deploy/.env
sed -i 's|^TURN_HOST=.*|TURN_HOST=devverse.203-0-113-7.sslip.io|' deploy/.env
# The TURN relay needs the public IP and the private one Azure's NAT maps it to.
sed -i "s|^TURN_EXTERNAL_IP=.*|TURN_EXTERNAL_IP=203.0.113.7/$(hostname -I | awk '{print $1}')|" deploy/.env
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET RUNNER_TOKEN TURN_SECRET; do
  sed -i "s|^$k=.*|$k=$(openssl rand -base64 48 | tr -d '\n')|" deploy/.env
done

# Then paste the Atlas string from step 2 after MONGODB_URI=.
nano deploy/.env
```

`PUBLIC_URL` is `https://devverse.<ip with dashes>.sslip.io`: replace `203-0-113-7` with your VM's IP. `TURN_HOST` is the same name without `https://`, and `TURN_EXTERNAL_IP` starts with the VM's public IP (`203.0.113.7`).

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

**Updating from before calls had TURN** (November 2026): `docker compose` stops with "required variable TURN_HOST is missing" until `deploy/.env` has the three TURN settings. Add them once (with your VM's IP), and open the three TURN ports in the Network Security Group (see Firewall):

```bash
cat >> deploy/.env <<EOF
TURN_HOST=devverse.203-0-113-7.sslip.io
TURN_EXTERNAL_IP=203.0.113.7/$(hostname -I | awk '{print $1}')
TURN_SECRET=$(openssl rand -base64 48 | tr -d '\n')
EOF
```

Only containers whose image changed restart. The certificate is kept in the `caddy-data` volume, so rebuilds don't
request a new one; Let's Encrypt limits how many it issues. After changing `runner/sandboxes/`, rebuild the sandbox
images with `sh runner/sandboxes/build.sh`.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No HTTPS certificate                             | `docker compose -f docker-compose.prod.yml logs web`. Ports 80 and 443 must be open in the VM's Network Security Group, the VM must be running, and `PUBLIC_URL` must contain its own IP.                                                                                                                                                                                                              |
| `bad auth : Authentication failed` in `logs api` | The database user or password in `MONGODB_URI` doesn't match Atlas (Security → Database Access). The API keeps restarting until it does, and Caddy waits for it.                                                                                                                                                                                                                                       |
| 502 Bad Gateway                                  | The API isn't healthy: `docker compose -f docker-compose.prod.yml logs api`. A bad `MONGODB_URI`, or the IP missing from Atlas's Network Access, are the usual causes.                                                                                                                                                                                                                                 |
| The server refuses to start                      | `logs api` lists the setting that is missing or invalid.                                                                                                                                                                                                                                                                                                                                               |
| Runs fail                                        | Run `docker compose -f docker-compose.prod.yml exec api node -e "fetch('http://runner:5050/healthz').then(r => r.text()).then(console.log)"`. It lists the sandbox images the runner can see. Build any that are missing with `runner/sandboxes/build.sh`.                                                                                                                                             |
| Calls don't connect on some networks             | Check that `GET /api/v1/turn-credentials` returns a `turn:` entry (the API logs a warning at start-up if TURN isn't configured), the three TURN ports are open, and `TURN_EXTERNAL_IP` has the right public and private IPs. `docker compose -f docker-compose.prod.yml logs turn` shows each allocation. In Chrome, `chrome://webrtc-internals` lists the candidates: a `relay` one means TURN works. |
| Status of everything                             | `docker compose -f docker-compose.prod.yml ps`                                                                                                                                                                                                                                                                                                                                                         |

## Security notes

- **Docker socket:** only `runner` gets `/var/run/docker.sock`, which is equivalent to root on the host (ADR 005). It
  has no published port, and its network has no internet route, so only the API can reach it. The API itself runs as
  a non-root user and has no Docker access.
- **Secrets** exist only in `deploy/.env` on the VM, with mode 600. Each container receives only the variables it
  needs: the runner never sees the database address or the JWT secrets.
- **TURN** isn't an open relay: it only accepts credentials signed with `TURN_SECRET`, which expire after 4 hours, and it refuses to relay to private, loopback and Azure platform addresses, so it can't be used to reach the VM's internal network. Each user gets at most 12 relays, at up to 1.5 Mbps each. The secret is passed to coturn on its command line, so anyone with root on the VM can see it, as they can see `deploy/.env`.
- **No access logs** in Caddy: the Yjs WebSocket URL carries the access token in its query string.
- **Headers:** Caddy adds HSTS, `nosniff` and a referrer policy to every response, and Helmet adds a CSP to API
  responses. A CSP for the SPA itself is in Week 4's security pass (PLAN §9, day 24).

## Rehearsing locally

The same stack runs on a laptop with Docker, to check changes to the Dockerfiles or the Caddyfile. Use a settings
file with `PUBLIC_URL=http://localhost` (plain HTTP, so no certificate is needed), the local MongoDB
(`MONGODB_URI=mongodb://host.docker.internal:27017/devverse-rehearsal?replicaSet=rs0&directConnection=true`, after
`npm run db:up`), and on macOS a `RUNS_DIR` that Docker Desktop shares, such as `/private/tmp/devverse-runs`. Then
`docker compose -f docker-compose.prod.yml --env-file <that file> up -d --build` and open http://localhost.
