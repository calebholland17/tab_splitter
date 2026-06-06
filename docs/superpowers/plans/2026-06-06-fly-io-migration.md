# Fly.io Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate TabSplitter from Railway to Fly.io with scale-to-zero and a persistent SQLite volume, restoring the app to its custom domain at zero recurring cost.

**Architecture:** Three infrastructure files are added to the repo (`Dockerfile`, `fly.toml`, `.github/workflows/deploy.yml`) plus a `.dockerignore`. One-time CLI commands create the Fly.io app, persistent volume, and secrets. No application code changes.

**Tech Stack:** Fly.io (hosting), flyctl CLI, Docker (two-stage Alpine build), GitHub Actions (CI/CD)

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `Dockerfile` | Two-stage build: compiles better-sqlite3 native bindings in builder, ships lean production image |
| Create | `.dockerignore` | Excludes node_modules, local DB files, .env from Docker build context |
| Create | `fly.toml` | Fly.io app config: scale-to-zero, volume mount, port, machine size |
| Create | `.github/workflows/deploy.yml` | Auto-deploy to Fly.io on every push to main |

---

## Task 1: Install flyctl

**Files:** none (CLI tool, not committed to repo)

- [ ] **Step 1: Install flyctl via Homebrew**

```bash
brew install flyctl
```

- [ ] **Step 2: Verify installation**

```bash
flyctl version
```

Expected output: `flyctl v0.x.x ...` (any recent version is fine)

- [ ] **Step 3: Commit nothing** — flyctl is a local tool, nothing to commit here.

---

## Task 2: Create Fly.io account and register the app

**Files:** none (Fly.io account setup, not committed to repo)

- [ ] **Step 1: Sign up at fly.io**

Go to https://fly.io and create an account. You will need to add a credit card — this is required even for the free tier. You will not be charged as long as usage stays within the $5/month credit (which it will for this app).

- [ ] **Step 2: Authenticate flyctl**

```bash
flyctl auth login
```

This opens a browser window. Log in and authorize the CLI.

- [ ] **Step 3: Verify authentication**

```bash
flyctl auth whoami
```

Expected output: your email address.

- [ ] **Step 4: Register the app name**

```bash
flyctl apps create tabsplitter
```

> **Note:** App names on Fly.io are globally unique. If `tabsplitter` is taken you'll get an error — try `tabsplitter-app` or `tabsplitter-ch` and update the `app = "..."` line in `fly.toml` (Task 4) to match.

Expected output: `New app created: tabsplitter`

---

## Task 3: Add Dockerfile and .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

Create `/Users/calebholland/projects/TabSplitter/Dockerfile` with this exact content:

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

The builder stage installs C++ toolchain tools (`python3 make g++`) needed to compile `better-sqlite3`'s native bindings. The production stage copies only the compiled `node_modules` and source files — no build tools shipped to production.

- [ ] **Step 2: Create .dockerignore**

Create `/Users/calebholland/projects/TabSplitter/.dockerignore` with this exact content:

```
node_modules
.env
tabsplitter.db
tabsplitter.db-shm
tabsplitter.db-wal
test-results
.git
docs
```

This prevents local `node_modules` (wrong platform), local DB files, and secrets from being copied into the Docker build context. Without this, the `COPY . .` step in the production stage would overwrite the correctly-compiled `node_modules` with your Mac-compiled ones, which won't run on Linux.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile and .dockerignore for Fly.io deployment"
```

---

## Task 4: Add fly.toml

**Files:**
- Create: `fly.toml`

- [ ] **Step 1: Create fly.toml**

Create `/Users/calebholland/projects/TabSplitter/fly.toml` with this exact content:

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

> **If you used a different app name in Task 2** (e.g. `tabsplitter-app`), change `app = "tabsplitter"` to match.

Key settings:
- `auto_stop_machines = "stop"` + `min_machines_running = 0` — machine shuts down when idle, wakes on next request (~3-5s cold start)
- `DB_PATH = "/data/tabsplitter.db"` — tells the app where to find the SQLite file on the persistent volume
- `[[mounts]]` — binds the volume named `tabsplitter_data` to `/data` inside the machine

- [ ] **Step 2: Commit**

```bash
git add fly.toml
git commit -m "feat: add fly.toml for Fly.io deployment config"
```

---

## Task 5: Create persistent volume and set secrets

**Files:** none (Fly.io platform setup)

- [ ] **Step 1: Create the persistent volume**

```bash
flyctl volumes create tabsplitter_data --size 1 --region ord
```

Expected output includes a table showing the new volume with `State: created`.

This 1GB volume will hold `tabsplitter.db`. It persists across machine restarts and app deploys — this is what keeps tabs alive from Friday evening to Sunday afternoon.

- [ ] **Step 2: Verify the volume was created**

```bash
flyctl volumes list
```

Expected: one row showing `tabsplitter_data`, size 1GB, region ord.

- [ ] **Step 3: Set the ANTHROPIC_API_KEY secret**

```bash
flyctl secrets set ANTHROPIC_API_KEY=your_actual_key_here
```

Replace `your_actual_key_here` with your real Anthropic API key (the same one you used in Railway). Fly.io stores this encrypted and injects it as an environment variable at runtime.

- [ ] **Step 4: Verify the secret is registered**

```bash
flyctl secrets list
```

Expected: one row showing `ANTHROPIC_API_KEY` with a digest (the value itself is never shown).

---

## Task 6: First deploy and smoke test

**Files:** none

- [ ] **Step 1: Deploy**

```bash
flyctl deploy
```

This builds the Docker image on Fly.io's infrastructure and deploys it. First deploy takes 2-4 minutes. You'll see build logs streaming in the terminal.

Expected final line: `Visit your newly deployed app at https://tabsplitter.fly.dev`

- [ ] **Step 2: Check machine status**

```bash
flyctl status
```

Expected: one machine row showing `started` or `stopped` (stopped is fine — scale-to-zero means it may have already shut down after the health check passed).

- [ ] **Step 3: Open the app and verify it loads**

```bash
flyctl open
```

This opens `https://tabsplitter.fly.dev` in your browser. Verify:
- The setup page loads
- You can create a tab (this writes to the SQLite volume)
- Navigate to the tab URL — items appear

- [ ] **Step 4: Verify data persists across a machine restart**

```bash
# Restart the machine
flyctl machine restart

# Wait 10 seconds, then open the app again
flyctl open
```

Navigate back to the tab URL you created in Step 3. Items should still be there. If they are, the volume is working correctly.

---

## Task 7: Add GitHub Actions auto-deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p /Users/calebholland/projects/TabSplitter/.github/workflows
```

- [ ] **Step 2: Create deploy.yml**

Create `/Users/calebholland/projects/TabSplitter/.github/workflows/deploy.yml` with this exact content:

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

`--remote-only` tells flyctl to build the Docker image on Fly.io's servers rather than inside the GitHub Actions runner, which is faster and avoids shipping a large image over the network.

- [ ] **Step 3: Generate a Fly.io deploy token**

```bash
flyctl tokens create deploy -x 999999h
```

Copy the token that is printed — you'll need it in the next step. (`-x 999999h` makes it valid for ~114 years so you don't have to rotate it.)

- [ ] **Step 4: Add the token to GitHub**

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

- Name: `FLY_API_TOKEN`
- Value: paste the token from Step 3

Click **Add secret**.

- [ ] **Step 5: Commit and push to trigger the first auto-deploy**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions workflow for Fly.io auto-deploy"
git push origin main
```

- [ ] **Step 6: Verify the workflow runs**

Go to your GitHub repo → **Actions** tab. You should see a workflow run called "Deploy to Fly.io" in progress or completed. Click into it and confirm the deploy step shows green.

- [ ] **Step 7: Verify the app is still up after the CI deploy**

```bash
flyctl open
```

The app should load. This confirms the full push-to-deploy pipeline works.

---

## Task 8: Migrate custom domain

**Files:** none (DNS changes at your registrar)

- [ ] **Step 1: Add your domain to Fly.io**

```bash
flyctl certs add yourdomain.com
flyctl certs add www.yourdomain.com
```

Replace `yourdomain.com` with your actual domain.

- [ ] **Step 2: Get the DNS records Fly.io needs**

```bash
flyctl certs show yourdomain.com
```

Expected output includes either:
- An **A record** IP address (e.g. `66.241.124.x`) — add this as an `A` record at your registrar
- A **CNAME** target (e.g. `tabsplitter.fly.dev`) — add this as a `CNAME` record at your registrar

Run the same for `www.yourdomain.com`:

```bash
flyctl certs show www.yourdomain.com
```

- [ ] **Step 3: Update DNS at your registrar**

Log into wherever you bought the domain (Namecheap, GoDaddy, Google Domains, etc.) and update the DNS records:

| Type | Host | Value |
|---|---|---|
| A | `@` | IP from flyctl certs show |
| CNAME | `www` | `yourdomain.com` or CNAME target from flyctl |

Remove any old Railway DNS records pointing to Railway's IP or CNAME.

- [ ] **Step 4: Wait for DNS propagation and verify**

DNS can take anywhere from a few minutes to a few hours. Check with:

```bash
flyctl certs show yourdomain.com
```

When the `Certificate` column shows `Ready`, SSL is provisioned and the domain is live. Open `https://yourdomain.com` in your browser to confirm.
