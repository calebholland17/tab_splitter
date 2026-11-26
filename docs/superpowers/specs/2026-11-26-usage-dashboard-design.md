# Usage Dashboard, Scan Limits & Tip Button — Design

**Date:** 2026-11-26
**Status:** Approved in conversation; awaiting written-spec review
**Branch:** `feat/usage-dashboard`

## Goal

Give the owner (Caleb) a private dashboard that shows usage and growth of Split Your Tab, gets ahead of overuse of the paid receipt-scanning feature, and starts a small revenue stream via an optional tip button.

### Success criteria

- Opening `/admin` on a phone shows: this week vs last week (tabs, guests, $ split), today's scans vs the daily cap, and this month's API cost.
- A script hammering `/api/receipt/parse` is stopped before it reaches the Anthropic API, and the owner can see it happened.
- Hosts see a low-key "Leave a tip!" row on the host page that opens Venmo to `@Caleb-Holland-3`.
- No new services, no new runtime dependencies, nothing that breaks the existing flows.

### Out of scope (this phase)

Page views / visitor analytics, paid scan packs or any payment processing, email/push alerts, user accounts.

## Constraints discovered

- **Fly machines auto-stop** (`auto_stop_machines = "stop"`, `min_machines_running = 0`). In-memory counters would reset on every sleep, so rate limits are counted from SQLite (persistent volume at `/data`), not memory.
- Single SQLite DB, synchronous `better-sqlite3`, `makeStore(db)` factory pattern; tests use `:memory:`.
- `public/` is served statically; no build step; vanilla JS.
- Nothing is ever deleted from `tabs`/`guests`/`items`, so tab/guest/$ history is available back to launch. Scan history and the "started from scan" flag only exist from deploy onward.

## 1. Data & event logging

### Schema (added to `SCHEMA` in `db.js`)

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  tab_id TEXT,
  ip_hash TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_ip_time   ON events(ip_hash, created_at);
```

`created_at` is milliseconds since epoch (`Date.now()`), matching `tabs.created_at` in `createTab`.

### Event types

| type | logged in | tab_id | meta |
|---|---|---|---|
| `receipt_scan` | `/api/receipt/parse`, after every attempt that reaches the API | — | `{ ok: bool, items: n, inTok: n, outTok: n, error?: string }` |
| `scan_blocked` | `/api/receipt/parse`, when a limit rejects | — | `{ reason: "ip_hour" \| "daily_cap" \| "disabled" }` |
| `tab_created` | `POST /api/tabs` on success | new tab id | `{ scanned: bool }` |
| `guest_paid` | `POST /api/tabs/:tabId/paid` on success | tab id | `{ guestId }` |
| `tip_click` | `POST /api/events/tip` | tab id | `{ amount: 1 \| 2 \| "other" }` |

Token counts come from `response.usage.input_tokens` / `output_tokens`. If the API call itself throws, log `ok: false` with zero tokens. If the call succeeds but JSON parsing fails, log `ok: false` with the real token counts (that spend happened).

### Client IP

`req.get('Fly-Client-IP') || req.ip`, hashed as `sha256(IP_SALT + ip)` hex, stored truncated to 16 chars. Raw IPs are never stored. If `IP_SALT` is unset (local/tests) a fixed dev salt is used.

### "Scanned" flag

`setup.js` sets a `scanned = true` flag on a successful scan, persists it in the existing `tabsplitter_draft` localStorage state, sends it as `scanned` in the `POST /api/tabs` body, and it is cleared with the draft. The server only uses it for the `tab_created` event's meta; it is not stored on the tab row.

### Store functions (in `makeStore`, exported like the others)

- `logEvent(type, { tabId, ipHash, meta }, now = Date.now())`
- `countEvents(type, { since, ipHash, where })` — count of events of `type` with `created_at >= since`, optionally filtered by `ip_hash` and by `json_extract(meta, '$.ok') = 1` for successful scans.
- `getStats(now)` — returns the full dashboard payload (section 3).

## 2. Scan rate limits

A guard at the top of `/api/receipt/parse`, before the upload is processed and before any API call, so blocked requests cost nothing. Checks in order:

1. `SCANS_DISABLED === "1"` → block, reason `disabled`.
2. Successful `receipt_scan` events from this `ip_hash` in the last 60 minutes `>= SCAN_LIMIT_PER_HOUR` (default **10**) → block, reason `ip_hour`.
3. Successful `receipt_scan` events since 00:00 UTC today `>= SCAN_LIMIT_PER_DAY` (default **500**) → block, reason `daily_cap`.

Only successful scans count toward limits (a user retrying a blurry photo shouldn't lock themselves out); failed scans still count toward dashboard cost.

Blocked response: HTTP `429`, logs `scan_blocked`, body `{ error }`:
- `ip_hour`: "You've scanned a lot of receipts recently — try again in a bit, or enter items manually."
- `daily_cap` / `disabled`: "Receipt scanning is taking a break right now — you can still enter items manually."

`setup.js` already displays `data.error` from a non-OK response, so these messages surface with no frontend change. Manual entry, claiming, and payments are unaffected.

Limits are read from env on each request (so tests can vary them). Owner action item: set a monthly spend limit in the Anthropic console as the hard backstop.

## 3. Admin dashboard

### Access

- `GET /api/admin/stats` requires `Authorization: Bearer <ADMIN_TOKEN>`, compared with `crypto.timingSafeEqual` (length-checked first).
- `ADMIN_TOKEN` unset → `404` (feature off). Wrong/missing key → `401`.
- `public/admin.html` + `public/js/admin.js`. On load, if `?key=` is present the page stores it in `localStorage` (`tabsplitter_admin_key`), strips it from the URL with `history.replaceState`, then fetches stats. A `401` clears the stored key and shows a "key invalid" message. The page contains no data itself.
- Server adds an explicit `app.get('/admin', …)` route to `admin.html`, matching the other page routes.

### Payload of `getStats(now)`

```js
{
  generatedAt, scannedSince,              // scannedSince = first tab_created event time (or null)
  growth: {
    tabs:   { last7, prev7, allTime },
    guests: { last7, prev7, allTime },
    split:  { last7, prev7, allTime },   // dollars: Σ item prices + Σ charges per tab
    weekly: [{ weekStart, tabs }] × 12    // oldest → newest
  },
  engagement: {
    scanRate,        // tab_created events with scanned=true / all tab_created events (since deploy); null if none
    avgGuestsPerTab, avgItemsPerTab,      // all-time
    paidRate         // guests paid / all guests, all-time
  },
  cost: {
    scansToday, scanCap, blockedToday,
    failRate7d,      // failed / all receipt_scan events in last 7d; null if none
    costTodayUsd, costMonthUsd,           // UTC day / UTC calendar month
    topIpsToday: [{ ipHash, scans }] × ≤5
  },
  tips: { last7, allTime }
}
```

Definitions: "last7" = `[now − 7d, now)`, "prev7" = `[now − 14d, now − 7d)`. Week-over-week % is computed client-side (shown as "—" when prev7 is 0). Tab totals parse each tab's `charges` JSON and add the charge values to the item subtotal.

**Cost:** `inTok × IN_PRICE + outTok × OUT_PRICE` per million tokens, as named constants in `db.js` for the scan model (`claude-haiku-4-5-20251001`). **Verify current Haiku 4.5 per-token pricing during implementation** rather than relying on memory.

### Layout

Single column on phones, two-column grid on wider screens, using `app.css` tokens. Four cards: **Growth** (three stat tiles with ▲/▼ %, all-time line, 12-week bar chart), **Engagement** (four stat tiles; scan rate labeled "since <date>"), **Cost & overuse** (scans today / cap with a meter, blocked today, 7-day fail rate, cost today / month, top IPs list), **Tips** (taps 7d / all-time). The bar chart is hand-built inline SVG, single color, labeled axis — no chart library. Loads once; a Refresh button refetches. No polling.

## 4. Tip button

- New `GET /api/config` → `{ tipHandle: process.env.TIP_VENMO_HANDLE || null }`.
- `host.html`: a row under the share box — "Leave a tip!" with `$1`, `$2`, `Other` buttons styled as `btn btn-outline`, small/secondary. Hidden unless `tipHandle` is non-null.
- `venmoUrl(handle, amount, note)` moves from `tab.js` to a new shared `public/js/venmo.js`, loaded by both `tab.html` and `host.html`. Guest payment behavior is unchanged. Tip links use note "TabSplitter tip"; `Other` passes no amount (on mobile, opens the pay screen with amount blank; on desktop all three open the profile URL, as `venmoUrl` already does). Today `venmoUrl` always emits `amount=` (the existing badge link passes `0`); change it to omit the `amount` param when `amount` is `null`/`undefined`, and keep current output for numeric amounts including `0`.
- On tap: `navigator.sendBeacon('/api/events/tip', JSON blob {tabId, amount})`, then navigate to the Venmo URL.
- `POST /api/events/tip` validates `amount ∈ {1, 2, "other"}` and that `tabId` exists; otherwise `400`, nothing logged. Returns `204`. (`sendBeacon` sends `text/plain` unless given a Blob with `application/json` type — use a Blob so `express.json()` parses it.)

## Configuration

| Name | Where | Default / value | Purpose |
|---|---|---|---|
| `ADMIN_TOKEN` | `fly secrets` | unset → dashboard off | dashboard key |
| `IP_SALT` | `fly secrets` | dev salt if unset | IP hashing |
| `TIP_VENMO_HANDLE` | `fly.toml [env]` | `Caleb-Holland-3` | tip row (hidden if unset) |
| `SCAN_LIMIT_PER_HOUR` | env, optional | `10` | per-IP hourly scans |
| `SCAN_LIMIT_PER_DAY` | env, optional | `500` | global daily scans |
| `SCANS_DISABLED` | secret, optional | unset | kill switch (`1` = off) |

`CLAUDE.md` gets the new page, endpoints, and env vars.

## Testing

- **`tests/db.test.js`**: `logEvent`/`countEvents` windows and filters; `getStats` with a fixed `now` and seeded tabs/events — last7/prev7 boundaries, $ split including charges, weekly buckets, scan rate, paid rate, cost math, top IPs, empty-DB nulls.
- **New `tests/server.test.js`** (supertest; `jest.mock('@anthropic-ai/sdk')` so no real API calls):
  - success scan logs `receipt_scan` with token counts; failed scan logs `ok: false`
  - after `SCAN_LIMIT_PER_HOUR` successes from one IP, next request → `429` + `scan_blocked` and the mock is not called
  - daily cap and `SCANS_DISABLED` each → `429`
  - failed scans do not count toward the limit
  - `/api/admin/stats`: `404` with no token configured, `401` wrong key, `200` correct key with expected shape
  - `/api/events/tip`: `204` valid, `400` bad amount / unknown tab
  - `tab_created` and `guest_paid` events logged by existing routes
- **E2E**: add `TIP_VENMO_HANDLE` to the Playwright `webServer.env`; one test that the host page shows the tip row and the `$1` link points to the expected Venmo URL.
- All unit tests run under `npm test`, which the deploy workflow already gates on.

## Rollout

1. Merge → auto-deploy. Events table is created by `CREATE TABLE IF NOT EXISTS` on boot.
2. `fly secrets set ADMIN_TOKEN=… IP_SALT=…` (generate with `openssl rand -hex 32`).
3. Set the Anthropic console monthly spend limit.
4. Bookmark `https://splityourtab.com/admin?key=…` once on phone.
