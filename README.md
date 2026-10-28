# Kiosk Dashboard

A non-interactive, dark-themed dashboard designed for FullPageOS / kiosk displays. Displays TrueNAS health, weather, mortgage & interest rates, stock market, package deliveries, news, Nextcloud calendar, and network status — all at a glance.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API keys and settings
npm install
npm start
# Open http://localhost:1337
```

## API Keys

You'll need to sign up for free API keys from these services:

| Service | Key | Sign Up |
|---------|-----|---------|
| AfterShip | `AFTERSHIP_API_KEY` | https://www.aftership.com/ |

TrueNAS and Nextcloud use credentials from your own instances.

## Deployment

### How it works

Run `./scripts/deploy-to-nas.sh` on your workstation. It builds a local Docker image, ships it to TrueNAS over SSH, loads it as `dashboard:local`, and recreates the container. No GitHub Actions, GHCR, or Watchtower.

Defaults (override with env vars):

| Variable | Default |
|----------|---------|
| `TRUENAS_HOST` | `10.0.0.16` |
| `TRUENAS_USER` | `root` |
| `TRUENAS_SSH_KEY` | `~/.ssh/truenas_root_rsa` |
| `DASHBOARD_REMOTE_DIR` | `/mnt/PrimaryHDDs01/custom-apps/dashboard` |

```bash
./scripts/deploy-to-nas.sh
# or
./scripts/deploy-to-nas.sh --no-cache
```

### First-time setup on TrueNAS

1. SSH into TrueNAS and create the app directory:

```bash
mkdir -p /mnt/PrimaryHDDs01/custom-apps/dashboard/data
cd /mnt/PrimaryHDDs01/custom-apps/dashboard
```

2. Install compose + env (from this repo):

```bash
# copy compose.nas.yaml → compose.yaml and .env.example → .env
```

3. Edit `.env`:
   - `TRUENAS_HOST=10.0.0.16`
   - `TRUENAS_PROTOCOL=https` (required — http/ws auto-revokes API keys on 25.10+)
   - `TRUENAS_API_KEY=` a **new** user-linked API key from the TrueNAS UI
   - service URLs / pings pointing at `10.0.0.16`

4. From your workstation run `./scripts/deploy-to-nas.sh`.

Dashboard URL: `http://10.0.0.16:1337`.

### TrueNAS API notes

- Uses JSON-RPC 2.0 over **persistent** `wss://…/api/current` (not deprecated REST `/api/v2.0`).
- API key auth must be TLS. Self-signed certs: `TRUENAS_TLS_REJECT_UNAUTHORIZED=false`.
- If keys were previously used over http/ws they are revoked — create a new key in **Credentials → Users → API Keys**.

### Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Or with Docker:

```bash
docker compose up -d --build
```

### Network Notes

If the dashboard can't reach LAN services (pings fail, service checks fail), add `network_mode: host` to the dashboard service in the compose file and remove the `ports` section.

## FullPageOS Setup

Point Chromium to `http://YOUR_TRUENAS_IP:1337` by editing `/boot/fullpageos.txt`.

## Configuration

All settings are in `.env`. See `.env.example` for the full list with descriptions.

Each dashboard section can be toggled with `ENABLE_*` flags. Refresh intervals are configurable per widget.

## Visual Editor

Open `http://YOUR_HOST:1337/editor` to rearrange the dashboard at any time.

- Drag containers to move; use the bottom-right handle to resize
- Add modules from the left palette; remove/duplicate in the inspector
- Scale individual widgets, rotate the whole canvas (0/90/180/270)
- Define custom API sources (server-proxied) under the **API Sources** tab
- Save writes `data/layout.json` (and `data/sources.json`); the kiosk at `/` hot-reloads via SSE
- Optional: set `EDITOR_TOKEN` in `.env` and paste it into the editor token field

### Adding a module

1. Register client UI in `public/js/modules/registry.js` (`mount` / `update`)
2. Add metadata in `server/module-meta.js` (palette + config schema)
3. If it needs server data, add a fetcher in `server.js` `BUILTIN_FETCHERS` or use a custom source

Persist layout across Docker restarts with the `./data:/app/data` volume (included in compose files).

