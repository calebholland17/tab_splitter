# Fly.io Migration Design

**Date:** 2026-06-06
**Status:** Approved

## Overview

Migrate TabSplitter from Railway (free trial exhausted) to Fly.io with scale-to-zero and a persistent volume for SQLite. No application code changes — infrastructure only.

## Goals

- Restore the app to its custom domain at zero recurring cost
- Preserve SQLite data across restarts and deploys (Friday-to-Sunday tab persistence)
- Maintain push-to-main auto-deploy workflow
- Stay within Fly.io's free usage credit (~$5/month)

## What Changes

| Added | Purpose |
|---|---|
| `Dockerfile` | Compiles better-sqlite3 native bindings for the target platform |
| `fly.toml` | Fly.io config: machine size, scale-to-zero, volume mount, port |
| `.github/workflows/deploy.yml` | Auto-deploy to Fly.io on push to main (replaces Railway GitHub integration) |

No changes to `server.js`, `db.js`, or any frontend files.

## Dockerfile

Two-stage build to keep the production image lean. The builder stage installs the C++ toolchain needed to compile `better-sqlite3`; the production stage only includes the runtime and compiled modules.

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## fly.toml

```toml
app = "tabsplitter"
primary_region = "ord"

[build]

[env]
  PORT = "3000"
  DB_PATH = "/data/tabsplitter.db"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"

[[mounts]]
  source = "tabsplitter_data"
  destination = "/data"
```

- `primary_region = "ord"` — Chicago. Adjust to `lax` (LA) or `iad` (Virginia) if preferred.
- `auto_stop_machines = "stop"` + `min_machines_running = 0` — scale-to-zero. Machine stops when idle, starts on next request (~3-5s cold start).
- `DB_PATH` is a plain env var (not sensitive). `ANTHROPIC_API_KEY` is set as a Fly secret via CLI and does not appear in this file.
- `[[mounts]]` binds the persistent volume `tabsplitter_data` to `/data` inside the machine.

## GitHub Actions Workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to Fly.io
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

`--remote-only` runs the Docker build on Fly.io's infrastructure rather than in the Actions runner. One-time setup: add `FLY_API_TOKEN` to GitHub repo → Settings → Secrets → Actions.

## One-Time CLI Setup (not committed to repo)

Run these once after creating a Fly.io account:

```bash
flyctl auth login
flyctl apps create tabsplitter      # registers the app name, does not touch fly.toml
flyctl volumes create tabsplitter_data --size 1 --region ord
flyctl secrets set ANTHROPIC_API_KEY=<your-key>
flyctl deploy
```

## Custom Domain Migration

After the app is running on Fly.io:

```bash
flyctl certs add yourdomain.com
flyctl certs add www.yourdomain.com
```

Fly.io provides an `A` record IP or `CNAME` target. Update DNS at your registrar to point there instead of Railway. SSL is handled automatically by Fly.io. DNS propagation: minutes to a few hours, no downtime.

## Cost Estimate

| Resource | Cost |
|---|---|
| shared-cpu-1x, 256MB (scale-to-zero) | ~$0–$3/month depending on usage |
| 1GB persistent volume | $0.15/month |
| **Total** | **Well within $5/month Fly.io credit** |

## Future Considerations

If accounts with phone number auth are added later, this will require migrating from SQLite to Postgres. At that point: rewrite `db.js` as async, adopt a Postgres client (e.g. `pg`), and provision a managed Postgres database (Neon recommended for free tier). The infrastructure work done here (Dockerfile, Fly.io setup) remains largely unchanged.
