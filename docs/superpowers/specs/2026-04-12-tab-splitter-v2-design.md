# TabSplitter v2 Design Spec

## Goal

Upgrade TabSplitter from a hardcoded single-tab app to a general-purpose receipt-splitting tool: hosts upload a receipt photo, Claude parses it, guests claim items via a unique shareable link, and state persists across restarts via SQLite.

## Architecture

Node.js + Express backend with `better-sqlite3` for persistence. Claude Haiku vision API for receipt parsing. 2-second client-side polling for real-time updates. Hosted on Railway (persistent process, no spin-down). Frontend stays vanilla HTML/CSS/JS — no framework, no build step.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3, @anthropic-ai/sdk, multer, Railway, Playwright (E2E tests), Jest (unit tests)

---

## Pages

### `/` — Setup Page (new)
The host creates a new tab here. Flow:
1. Upload a receipt photo (optional — can skip to manual entry)
2. Photo is sent to `POST /api/receipt/parse` → Claude Haiku returns `[{ name, price, qty }]`
3. An editable item list renders — host can rename items, fix prices, delete rows, add rows
4. Host fills in: tab name, payment handle (e.g. `@Caleb-Holland-3`), payment platform (e.g. `Venmo`), and guest names (one per line or comma-separated)
5. "Create Tab" → `POST /api/tabs` → SQLite → 302 redirect to `/host/:tabId`

If parsing fails or the host skips the photo, the item list starts empty and is filled in manually.

### `/host/:tabId` — Host Monitor (upgraded)
- Displays the shareable guest link: `{origin}/tab/:tabId`
- Copy Link button (no alert — button text changes to "Copied!" for 2s)
- Progress bar: guests paid / total guests
- Guest status list: name, amount owed, Paid/Pending badge
- Settlement overlay when all guests have paid

### `/tab/:tabId` — Guest Page (upgraded)
Same UI as current app, scoped to a specific tab:
- Venmo handle banner
- Name chip picker (select your name to unlock items)
- Items grouped by name, individually claimable
- Charges breakdown (subtotal, surcharge, tax, gratuity, total)
- Sticky footer with personal subtotal, fees, total owed, and "I've Settled My Tab" button
- Settlement overlay when tab is fully paid

---

## Data Model

SQLite database at `tabsplitter.db`, managed by `db.js`.

```sql
CREATE TABLE tabs (
  id TEXT PRIMARY KEY,           -- 6-char random slug, e.g. "abc123"
  name TEXT NOT NULL,
  payment_handle TEXT NOT NULL,
  payment_platform TEXT NOT NULL,
  charges TEXT NOT NULL,         -- JSON: {subtotal, surcharge, tax, gratuity, total}
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'settled'
  created_at INTEGER NOT NULL
);

CREATE TABLE guests (
  id TEXT PRIMARY KEY,           -- random hex
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0   -- 0 | 1
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,           -- random hex
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  name TEXT NOT NULL,
  price REAL NOT NULL,
  claimed_by TEXT REFERENCES guests(id)  -- NULL if unclaimed
);
```

`db.js` exports: `createTab`, `getTabView`, `claimItem`, `unclaimItem`, `markPaid`, `isSettled`

`getTabView(tabId)` returns the same shape the frontend already expects — guests with `subtotal` and `owed` computed via the proportional multiplier (`total / subtotal`).

---

## API

### Receipt Parsing
`POST /api/receipt/parse`
- Body: `multipart/form-data` with `image` field
- Sends image to Claude Haiku with a prompt to extract line items
- Returns: `{ items: [{ name, price, qty }] }`
- On failure: `{ error: "..." }` with status 400

### Tab Management
`POST /api/tabs`
- Body: `{ name, paymentHandle, paymentPlatform, charges, guests: [string], items: [{name, price, qty}] }`
- Creates tab + guests + expanded items in SQLite
- Returns: `{ tabId }` (frontend redirects to `/host/:tabId`)

`GET /api/tabs/:tabId`
- Returns full tab view (same shape as current `/api/tab`)

`POST /api/tabs/:tabId/claim` — body: `{ itemId, guestId }`

`POST /api/tabs/:tabId/unclaim` — body: `{ itemId, guestId }`

`POST /api/tabs/:tabId/paid` — body: `{ guestId }` — returns `{ tab, settled }`

---

## Receipt Parsing Detail

Claude Haiku is called with the image as a base64-encoded `image_url` block. System prompt:

> "You are a receipt parser. Extract all line items from this receipt image. For each item return name, unit price, and quantity. Respond only with a JSON array: [{\"name\": string, \"price\": number, \"qty\": number}]. If a line says '3 @ $6.50', that is qty=3, price=6.50. Do not include subtotals, taxes, tips, or totals."

The response is parsed as JSON. If parsing throws, the endpoint returns a 400 with the raw Claude response so the host can manually enter items.

`ANTHROPIC_API_KEY` is read from environment variables. Never committed to the repo.

---

## Real-time Updates

Client-side polling every 2 seconds via `fetch('/api/tabs/:tabId')`. On user action (claim, unclaim, pay), the POST response returns the updated tab view immediately — no need to wait for the next poll.

---

## File Structure

```
server.js           — Express routes (updated to :tabId params)
db.js               — SQLite layer (replaces tabStore.js)
public/
  index.html        — Setup page (new)
  host.html         — Host monitor (updated)
  tab.html          — Guest page (updated)
  css/app.css       — Shared styles (add setup page styles)
  js/
    setup.js        — Setup page logic (new)
    host.js         — Host monitor logic (updated)
    tab.js          — Guest page logic (updated)
tests/
  db.test.js        — Jest unit tests for db.js
  e2e/
    flow.spec.js    — Playwright E2E tests
```

`tabStore.js` is deleted. `db.js` is the replacement with the same exported function signatures where possible.

---

## Testing

### Jest Unit Tests (`tests/db.test.js`)
- `createTab` creates tab, guests, and expanded items correctly
- `claimItem` assigns unclaimed item; rejects already-claimed item
- `unclaimItem` removes claim by same guest; rejects wrong guest
- `markPaid` marks guest paid; idempotent on double-pay
- `isSettled` returns false until all guests paid; true when all paid
- `getTabView` calculates proportional owed amounts correctly

Each test creates a fresh in-memory SQLite database (`:memory:`) — no file cleanup needed.

### Playwright E2E Tests (`tests/e2e/flow.spec.js`)
- **Setup flow:** Fill in tab name, items, guests → create tab → redirects to host page → shareable link is correct
- **Claim persistence:** Guest claims item → refreshes page → item still claimed
- **Multi-guest:** Two guests claim different items → each sees correct totals
- **Settlement:** All guests mark paid → settlement overlay appears on both host and guest pages

---

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...   # Required for receipt parsing
PORT=3000                       # Optional, defaults to 3000
```

Set in Railway dashboard under "Variables". Local development uses `.env` (already in `.gitignore`).

---

## Deployment

Railway detects Node.js automatically. Start command: `node server.js`. No build step.

GitHub Actions workflow (`.github/workflows/deploy.yml`) deploys on push to `main` using Railway's deploy action and a `RAILWAY_TOKEN` secret set in the GitHub repo settings.
