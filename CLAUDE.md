# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start server with --watch (auto-restarts on file changes)
npm test             # Unit tests (Jest, in-memory SQLite, no E2E)
npm run test:e2e     # Playwright E2E tests (spins up its own server on port 3001)
npm start            # Production start
```

Run a single Jest test file:
```bash
DB_PATH=:memory: NODE_ENV=test npx jest tests/db.test.js --forceExit
```

Run a single Playwright test by title:
```bash
npx playwright test --grep "test title here"
```

E2E tests against the deployed app:
```bash
BASE_URL=https://splityourtab.com npx playwright test
```

**Env vars:** `ANTHROPIC_API_KEY` is required for receipt scanning (`/api/receipt/parse`). Optional: `ADMIN_TOKEN` (enables `/admin`; 404 when unset), `IP_SALT` (IP hashing), `TIP_VENMO_HANDLE` (tip row; set in `fly.toml`), `SCAN_LIMIT_PER_HOUR`, `SCAN_LIMIT_PER_DAY`, `SCANS_DISABLED`. `dotenv` is skipped when `NODE_ENV` is `production` or `test`.

## Architecture

Three-page app: **setup** (`/`) → **host monitor** (`/host/:tabId`) → **guest tab** (`/tab/:tabId`), plus a private **admin dashboard** (`/admin`).

**Backend** (`server.js` + `db.js`):
- Express serves static files and a small REST API
- SQLite via `better-sqlite3` (synchronous, no ORM)
- `db.js` exports a `makeStore(db)` factory — production uses a file-based DB, tests pass `:memory:`. The module also exports the production store directly for convenience.
- Items are expanded at creation time: `qty: 2` for "Beer" creates 2 separate item rows, each independently claimable by different guests.
- Guest `owed` amount is calculated as `guestSubtotal × (total / subtotal)` — a proportional share of fees/tip, not a fixed split.
- `events` table logs `receipt_scan`, `scan_blocked`, `tab_created`, `guest_paid`, `tip_click` (IP stored only as a salted 16-char hash). `stats.js` aggregates it plus tabs/guests/items for `GET /api/admin/stats`.
- Receipt scans are rate-limited by counting `events` rows (not memory — the Fly machine auto-stops): `SCAN_LIMIT_PER_HOUR` per IP (default 10), `SCAN_LIMIT_PER_DAY` global (default 500, UTC day), `SCANS_DISABLED=1` kill switch. Blocked → 429.

**Frontend** — vanilla JS, no build step, no framework:
- `public/js/setup.js` — form state persisted to `localStorage` under key `tabsplitter_draft`; cleared on successful tab creation. Reads back on page load so refreshes don't wipe the form. Each item has a "split mode" toggle (`÷` vs `×`): in split mode the entered price is the *total* for the group and gets divided by `qty` client-side before the item is sent to `/api/tabs` — the server only ever stores a single already-divided per-item price (see `db.js` schema, which has no split/group concept).
- `public/js/tab.js` — guest identity persisted in `sessionStorage` (key `tab_identity_<tabId>`); resets on back-navigation via `pageshow` event. Live state polled every 2s from `/api/tabs/:tabId`.
- `public/js/host.js` — host-only "Mark Paid" confirmation per guest; polls every 2s. Guests cannot self-report payment.
- `public/js/admin.js` — dashboard; key passed once as `/admin?key=…`, stored in `localStorage` (`tabsplitter_admin_key`), sent as `Authorization: Bearer`.
- `public/js/venmo.js` — shared `venmoUrl()` used by `tab.js` (guest payment) and `host.js` (tip row, shown only when `TIP_VENMO_HANDLE` is set).
- `public/css/app.css` — single stylesheet, light-mode only, uses CSS custom properties defined on `:root`.

**Payment flow:** Guest selects items → taps Venmo link (deep link on mobile, web URL on desktop) → host receives Venmo notification → host taps "Mark Paid" on host page. There is no Venmo API integration; confirmation is manual.

**Receipt scanning:** POST to `/api/receipt/parse` sends image to `claude-haiku-4-5-20251001` which returns structured JSON. The prompt handles unit-price vs. line-total ambiguity and populates both items and charges (tax/surcharge/gratuity).

**Deployment:** Fly.io (`fly.toml` + two-stage `Dockerfile`), auto-deploys via GitHub Actions (`.github/workflows/deploy.yml`) on push to `main` — the workflow runs `npm test` before `flyctl deploy`. SQLite lives on a persistent Fly volume mounted at `/data` (`DB_PATH=/data/tabsplitter.db`, set in `fly.toml`). Live at https://splityourtab.com.