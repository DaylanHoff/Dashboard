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

TrueNAS health uses the supported **JSON-RPC 2.0 over WebSocket** API (`/api/current`), not the deprecated REST `/api/v2.0` endpoints (removed in TrueNAS 26.04).

## Deployment

### How it works

1. Push to `main`
2. GitHub Actions builds and pushes `ghcr.io/daylanhoff/dashboard:latest`
3. On TrueNAS, systemd timer `dashboard-auto-deploy.timer` polls GHCR about every minute and runs the canonical force-recreate path when the image digest changes:

```bash
cd /mnt/.ix-apps/app_configs/dashboard/versions/1.0.0/templates/rendered
docker compose -p ix-dashboard -f docker-compose.yaml pull dashboard
docker compose -p ix-dashboard -f docker-compose.yaml up -d --force-recreate dashboard
```

Script/log location on TrueNAS: `/mnt/PrimaryHDDs01/custom-apps/dashboard/auto-deploy.sh` and `auto-deploy.log`.

Watchtower remains installed as a backup, but compose force-recreate is the canonical deploy so env-file and image updates always apply.

### Versioning

`package.json` `version` is the user-facing app version (shown via `/api/config`). Bump it on every functional change (patch/minor/major).


### First-time setup on TrueNAS

1. SSH into your TrueNAS system
2. Create a directory for the dashboard config:

```bash
mkdir -p /mnt/your-pool/apps/dashboard
cd /mnt/your-pool/apps/dashboard
```

3. Download the production compose file and create your `.env`:

```bash
curl -O https://raw.githubusercontent.com/DaylanHoff/Dashboard/main/docker-compose.prod.yml
curl -o .env https://raw.githubusercontent.com/DaylanHoff/Dashboard/main/.env.example
```

4. Edit `.env` with your settings (coordinates, TrueNAS API key, etc.)

5. Start everything:

```bash
docker compose -f docker-compose.prod.yml up -d
```

The dashboard will be at `http://YOUR_TRUENAS_IP:1337`. Watchtower checks for new images every 5 minutes and auto-restarts with zero downtime.

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
