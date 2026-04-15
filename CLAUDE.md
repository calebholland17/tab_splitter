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
DB_PATH=:memory: NODE_ENV=test npx jest tests/unit/sometest.test.js --forceExit
```

Run a single Playwright test by title:
```bash
npx playwright test --grep "test title here"
```

E2E tests against the deployed Railway app:
```bash
BASE_URL=https://tabsplitter-production.up.railway.app npx playwright test
```

**Required env var:** `ANTHROPIC_API_KEY` must be set for receipt scanning (`/api/receipt/parse`). All other features work without it.

## Architecture

Three-page app: **setup** (`/`) → **host monitor** (`/host/:tabId`) → **guest tab** (`/tab/:tabId`).

**Backend** (`server.js` + `db.js`):
- Express serves static files and a small REST API
- SQLite via `better-sqlite3` (synchronous, no ORM)
- `db.js` exports a `makeStore(db)` factory — production uses a file-based DB, tests pass `:memory:`. The module also exports the production store directly for convenience.
- Items are expanded at creation time: `qty: 2` for "Beer" creates 2 separate item rows, each independently claimable by different guests.
- Guest `owed` amount is calculated as `guestSubtotal × (total / subtotal)` — a proportional share of fees/tip, not a fixed split.

**Frontend** — vanilla JS, no build step, no framework:
- `public/js/setup.js` — form state persisted to `localStorage` under key `tabsplitter_draft`; cleared on successful tab creation. Reads back on page load so refreshes don't wipe the form.
- `public/js/tab.js` — guest identity persisted in `sessionStorage` (key `tab_identity_<tabId>`); resets on back-navigation via `pageshow` event. Live state polled every 2s from `/api/tabs/:tabId`.
- `public/js/host.js` — host-only "Mark Paid" confirmation per guest; polls every 2s. Guests cannot self-report payment.
- `public/css/app.css` — single stylesheet, light-mode only, uses CSS custom properties defined on `:root`.

**Payment flow:** Guest selects items → taps Venmo link (deep link on mobile, web URL on desktop) → host receives Venmo notification → host taps "Mark Paid" on host page. There is no Venmo API integration; confirmation is manual.

**Receipt scanning:** POST to `/api/receipt/parse` sends image to `claude-haiku-4-5` which returns structured JSON. The prompt handles unit-price vs. line-total ambiguity and populates both items and charges (tax/surcharge/gratuity).

**Deployment:** Railway, auto-deploys on push to `main`. Set `DB_PATH` and `ANTHROPIC_API_KEY` as Railway environment variables.