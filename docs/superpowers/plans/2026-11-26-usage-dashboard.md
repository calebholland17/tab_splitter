# Usage Dashboard, Scan Limits & Tip Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an events log, a token-protected `/admin` usage dashboard, receipt-scan rate limits, and a Venmo tip row on the host page.

**Architecture:** One new SQLite `events` table records scans, blocks, tab creations, payments, and tip taps. Rate limits count rows in that table (the Fly machine auto-stops, so in-memory counters would reset). A pure `stats.js` module aggregates existing tables + events into one JSON payload served to a vanilla-JS admin page.

**Tech Stack:** Node 20 / Express 4 / better-sqlite3 (with SQLite JSON1 `json_extract`) / Jest + supertest / Playwright / vanilla JS + `public/css/app.css`.

**Spec:** `docs/superpowers/specs/2026-11-26-usage-dashboard-design.md`

## Global Constraints

- No new runtime dependencies. No build step. Frontend stays vanilla JS in `public/js/`.
- Raw IPs are never stored: `ip_hash = sha256(IP_SALT + ip)` hex, first 16 chars; IP comes from `Fly-Client-IP` header, falling back to `req.ip`.
- All timestamps are `Date.now()` milliseconds. "Today" / "month" are **UTC**.
- Defaults: `SCAN_LIMIT_PER_HOUR` = **10**, `SCAN_LIMIT_PER_DAY` = **500**; `SCANS_DISABLED=1` turns scanning off.
- Only **successful** scans (`meta.ok = true`) count toward limits; failed scans still count toward cost.
- Blocked scan → HTTP **429** with exactly these messages:
  - `ip_hour`: `You've scanned a lot of receipts recently — try again in a bit, or enter items manually.`
  - `daily_cap` / `disabled`: `Receipt scanning is taking a break right now — you can still enter items manually.`
- `ADMIN_TOKEN` unset → `/api/admin/stats` returns **404**; wrong/missing key → **401**; compare with `crypto.timingSafeEqual`.
- `TIP_VENMO_HANDLE` = `Caleb-Holland-3`; tip row hidden when unset. Tip note text: `TabSplitter tip`. Tip amounts accepted by server: `1`, `2`, `"other"` only.
- Scan cost constants (claude-haiku-4-5, verified 2026-11-26): **$1.00 / MTok input, $5.00 / MTok output**.
- Event logging must never break a user-facing request (wrap in try/catch, log to console).

### Deliberate refinements of the spec (decided while planning)

- Aggregation lives in a new `stats.js` (`buildStats(db, now)`); `makeStore` exposes it as `getStats(now)`, so the spec's interface is unchanged but `db.js` stays focused.
- `countEvents` takes `{ since, ipHash, okOnly }` rather than a generic `where` (YAGNI).
- A tab's "$ split" uses `charges.total` (which `setup.js` computes as subtotal + surcharge + tax + gratuity), falling back to summing the parts if `total` is missing.
- `listEvents(type)` is added to the store so tests can inspect logged meta.
- `server.js` skips `dotenv` when `NODE_ENV=test`, so a local `.env` (e.g. with `ADMIN_TOKEN`) can't leak into unit tests.
- The tip row carries a muted sub-line, "Tips go to the person who built TabSplitter", so hosts don't mistake it for tipping the restaurant.

## Review Focus

1. **Event logging failure breaks a core flow** — if the `events` insert throws (disk full, locked DB), creating a tab / marking paid / scanning must still succeed. Pinned in Task 3 (`logging failures never break tab creation`).
2. **Host double-taps "Mark Paid"** — must log exactly one `guest_paid` event. Pinned in Task 3.
3. **Admin key of a different length than `ADMIN_TOKEN`** — `timingSafeEqual` throws on length mismatch; must return 401, not 500. Pinned in Task 5.
4. **`hidden` attribute overridden by a CSS `display` rule** — `.tip-row` and `.admin-grid` set `display`, which beats the UA `[hidden]` style; row must actually disappear when no handle is configured. Pinned in Task 6 (E2E `tip row stays hidden when no handle is configured`) and the CSS `[hidden]` rules in Tasks 5–6.
5. **Old or odd rows in the DB** — tabs whose `charges` JSON lacks `total` or is malformed, and an empty database, must produce numbers / `null`, never `NaN` or a 500. Pinned in Task 2.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `db.js` | modify | `events` schema; `logEvent`, `countEvents`, `listEvents`, `getStats` on the store |
| `stats.js` | create | Pure dashboard aggregation + UTC date helpers + pricing constants |
| `server.js` | modify | IP hashing, `track()` helper, event logging in routes, scan guard, admin/config/tip endpoints, `/admin` page route |
| `public/js/setup.js` | modify | `scanned` flag in draft state and tab-create body |
| `public/js/venmo.js` | create | Shared `venmoUrl()` (moved from `tab.js`) |
| `public/js/tab.js`, `public/tab.html` | modify | Use shared `venmo.js` |
| `public/host.html`, `public/js/host.js` | modify | Tip row |
| `public/admin.html`, `public/js/admin.js` | create | Dashboard page |
| `public/css/app.css` | modify | Tip row + admin styles |
| `tests/db.test.js` | modify | Event store tests |
| `tests/stats.test.js` | create | Aggregation tests |
| `tests/server.test.js` | create | HTTP tests with mocked Anthropic SDK |
| `tests/venmo.test.js` | create | `venmoUrl` unit tests |
| `tests/e2e/flow.spec.js`, `playwright.config.js` | modify | E2E for scanned flag, tip row, admin page |
| `fly.toml`, `CLAUDE.md` | modify | Config + docs |

---

### Task 1: Events table and store functions

**Files:**
- Modify: `db.js` (SCHEMA string; `makeStore` body and its return)
- Test: `tests/db.test.js` (append)

**Interfaces:**
- Produces (on the object returned by `makeStore(db)` and on `require('./db')`):
  - `logEvent(type: string, { tabId?: string|null, ipHash?: string|null, meta?: object|null } = {}, now: number = Date.now()): void`
  - `countEvents(type: string, { since?: number = 0, ipHash?: string|null, okOnly?: boolean = false } = {}): number`
  - `listEvents(type: string): Array<{ type, tabId, ipHash, meta: object|null, createdAt: number }>` newest first

- [ ] **Step 1: Write the failing tests** — append to `tests/db.test.js`:

```js
describe('events', () => {
  it('logs events and counts them by type', () => {
    store.logEvent('tip_click', { tabId: 'abc123', meta: { amount: 1 } }, 1000);
    store.logEvent('tip_click', {}, 2000);
    store.logEvent('tab_created', {}, 2000);
    expect(store.countEvents('tip_click')).toBe(2);
    expect(store.countEvents('tab_created')).toBe(1);
    expect(store.countEvents('guest_paid')).toBe(0);
  });

  it('counts only events at or after `since`', () => {
    store.logEvent('receipt_scan', { meta: { ok: true } }, 1000);
    store.logEvent('receipt_scan', { meta: { ok: true } }, 5000);
    expect(store.countEvents('receipt_scan', { since: 5000 })).toBe(1);
    expect(store.countEvents('receipt_scan', { since: 5001 })).toBe(0);
  });

  it('filters by ipHash', () => {
    store.logEvent('receipt_scan', { ipHash: 'aaaa', meta: { ok: true } }, 1000);
    store.logEvent('receipt_scan', { ipHash: 'bbbb', meta: { ok: true } }, 1000);
    expect(store.countEvents('receipt_scan', { ipHash: 'aaaa' })).toBe(1);
  });

  it('okOnly counts only successful scans', () => {
    store.logEvent('receipt_scan', { meta: { ok: true } }, 1000);
    store.logEvent('receipt_scan', { meta: { ok: false } }, 1000);
    store.logEvent('receipt_scan', {}, 1000);
    expect(store.countEvents('receipt_scan', { okOnly: true })).toBe(1);
    expect(store.countEvents('receipt_scan')).toBe(3);
  });

  it('listEvents returns parsed meta, newest first', () => {
    store.logEvent('tip_click', { tabId: 't1', ipHash: 'h1', meta: { amount: 2 } }, 1000);
    store.logEvent('tip_click', { tabId: 't2' }, 2000);
    expect(store.listEvents('tip_click')).toEqual([
      { type: 'tip_click', tabId: 't2', ipHash: null, meta: null, createdAt: 2000 },
      { type: 'tip_click', tabId: 't1', ipHash: 'h1', meta: { amount: 2 }, createdAt: 1000 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/db.test.js --forceExit`
Expected: FAIL — `store.logEvent is not a function`.

- [ ] **Step 3: Implement** — in `db.js`, append to the `SCHEMA` template string (before the closing backtick):

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

Inside `makeStore`, after `markPaid`, add:

```js
  function logEvent(type, { tabId = null, ipHash = null, meta = null } = {}, now = Date.now()) {
    db.prepare('INSERT INTO events (type, tab_id, ip_hash, meta, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(type, tabId, ipHash, meta == null ? null : JSON.stringify(meta), now);
  }

  function countEvents(type, { since = 0, ipHash = null, okOnly = false } = {}) {
    let sql = 'SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ?';
    const args = [type, since];
    if (ipHash) { sql += ' AND ip_hash = ?'; args.push(ipHash); }
    if (okOnly) sql += " AND json_extract(meta, '$.ok') = 1";
    return db.prepare(sql).get(...args).n;
  }

  function listEvents(type) {
    return db.prepare('SELECT * FROM events WHERE type = ? ORDER BY id DESC').all(type).map(e => ({
      type: e.type,
      tabId: e.tab_id,
      ipHash: e.ip_hash,
      meta: e.meta ? JSON.parse(e.meta) : null,
      createdAt: e.created_at,
    }));
  }
```

Change the return line to:

```js
  return { createTab, getTabView, claimItem, unclaimItem, markPaid, isSettled, logEvent, countEvents, listEvents };
```

- [ ] **Step 4: Run to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/db.test.js --forceExit`
Expected: PASS (all existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add db.js tests/db.test.js
git commit -m "feat: add events table with logEvent/countEvents/listEvents"
```

---

### Task 2: Stats aggregation (`stats.js` + `getStats`)

**Files:**
- Create: `stats.js`
- Modify: `db.js` (require `stats.js`; add `getStats` to store return)
- Test: `tests/stats.test.js` (create)

**Interfaces:**
- Consumes: `logEvent`, `createTab`, `markPaid` from Task 1 / existing store.
- Produces:
  - `stats.js` exports `{ buildStats(db, now): Stats, startOfUtcDay(now): number, startOfUtcMonth(now): number, SCAN_INPUT_USD_PER_MTOK, SCAN_OUTPUT_USD_PER_MTOK }`
  - store `getStats(now: number = Date.now()): Stats` where `Stats` is:

```js
{
  generatedAt: number, scannedSince: number|null,
  growth: {
    tabs:   { last7, prev7, allTime },          // numbers
    guests: { last7, prev7, allTime },
    split:  { last7, prev7, allTime },          // dollars, 2dp
    weekly: [{ weekStart: number, tabs: number }] // length 12, oldest first
  },
  engagement: { scanRate: number|null, avgGuestsPerTab: number|null, avgItemsPerTab: number|null, paidRate: number|null },
  cost: { scansToday, blockedToday, failRate7d: number|null, costTodayUsd, costMonthUsd, topIpsToday: [{ ipHash, scans }] },
  tips: { last7, allTime }
}
```
  (`cost.scanCap` is added by the server in Task 5, not here.)

- [ ] **Step 1: Write the failing tests** — create `tests/stats.test.js`:

```js
const { buildDb, makeStore } = require('../db');
const { startOfUtcDay, startOfUtcMonth } = require('../stats');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 10, 26, 15, 0, 0); // Thu 26 Nov 2026, 15:00 UTC

let db, store;

beforeEach(() => {
  db = buildDb(':memory:');
  store = makeStore(db);
});

function tabAt(time, { guests = ['A', 'B'], total = 25.6 } = {}) {
  const id = store.createTab({
    name: 'T', paymentHandle: '@h', paymentPlatform: 'Venmo',
    charges: { subtotal: 20, surcharge: 0, tax: 1.6, gratuity: 4, total },
    guests,
    items: [{ name: 'Beer', price: 10, qty: 2 }],
  });
  db.prepare('UPDATE tabs SET created_at = ? WHERE id = ?').run(time, id);
  return id;
}

describe('UTC helpers', () => {
  it('startOfUtcDay returns midnight UTC', () => {
    expect(startOfUtcDay(NOW)).toBe(Date.UTC(2026, 10, 26));
  });
  it('startOfUtcMonth returns the first of the month UTC', () => {
    expect(startOfUtcMonth(NOW)).toBe(Date.UTC(2026, 10, 1));
  });
});

describe('getStats', () => {
  it('returns zeros and nulls (never NaN) for an empty database', () => {
    const s = store.getStats(NOW);
    expect(s.generatedAt).toBe(NOW);
    expect(s.scannedSince).toBeNull();
    expect(s.growth.tabs).toEqual({ last7: 0, prev7: 0, allTime: 0 });
    expect(s.growth.split).toEqual({ last7: 0, prev7: 0, allTime: 0 });
    expect(s.growth.weekly).toHaveLength(12);
    expect(s.growth.weekly.every(w => w.tabs === 0)).toBe(true);
    expect(s.engagement).toEqual({ scanRate: null, avgGuestsPerTab: null, avgItemsPerTab: null, paidRate: null });
    expect(s.cost).toEqual({ scansToday: 0, blockedToday: 0, failRate7d: null, costTodayUsd: 0, costMonthUsd: 0, topIpsToday: [] });
    expect(s.tips).toEqual({ last7: 0, allTime: 0 });
  });

  it('splits growth into last 7 days, previous 7 days, and all time', () => {
    tabAt(NOW - 1 * DAY);
    tabAt(NOW - 2 * DAY, { guests: ['A', 'B', 'C'], total: 10 });
    tabAt(NOW - 8 * DAY);
    tabAt(NOW - 30 * DAY);
    const { growth } = store.getStats(NOW);
    expect(growth.tabs).toEqual({ last7: 2, prev7: 1, allTime: 4 });
    expect(growth.guests).toEqual({ last7: 5, prev7: 2, allTime: 9 });
    expect(growth.split.last7).toBeCloseTo(35.6);
    expect(growth.split.prev7).toBeCloseTo(25.6);
    expect(growth.split.allTime).toBeCloseTo(86.8);
  });

  it('puts a tab created exactly 7 days ago in last7, not prev7', () => {
    tabAt(NOW - WEEK);
    const { growth } = store.getStats(NOW);
    expect(growth.tabs.last7).toBe(1);
    expect(growth.tabs.prev7).toBe(0);
  });

  it('falls back to summing charge parts when total is missing, and treats malformed charges as $0', () => {
    const a = tabAt(NOW - DAY);
    const b = tabAt(NOW - DAY);
    db.prepare('UPDATE tabs SET charges = ? WHERE id = ?').run('{"subtotal":10,"tax":1}', a);
    db.prepare('UPDATE tabs SET charges = ? WHERE id = ?').run('{not json', b);
    expect(store.getStats(NOW).growth.split.last7).toBeCloseTo(11);
  });

  it('buckets tabs into 12 rolling weeks, oldest first', () => {
    tabAt(NOW - DAY);
    tabAt(NOW - 8 * DAY);
    const { weekly } = store.getStats(NOW).growth;
    expect(weekly[0].weekStart).toBe(NOW - 12 * WEEK);
    expect(weekly[11].weekStart).toBe(NOW - WEEK);
    expect(weekly[11].tabs).toBe(1);
    expect(weekly[10].tabs).toBe(1);
  });

  it('computes engagement rates', () => {
    const t1 = tabAt(NOW - DAY);
    tabAt(NOW - DAY, { guests: ['A', 'B', 'C'] });
    const guestId = store.getTabView(t1).guests[0].id;
    store.markPaid(t1, guestId);
    store.logEvent('tab_created', { meta: { scanned: true } }, NOW - 3 * DAY);
    store.logEvent('tab_created', { meta: { scanned: false } }, NOW - 2 * DAY);
    store.logEvent('tab_created', { meta: { scanned: true } }, NOW - DAY);
    const s = store.getStats(NOW);
    expect(s.scannedSince).toBe(NOW - 3 * DAY);
    expect(s.engagement.scanRate).toBeCloseTo(2 / 3);
    expect(s.engagement.avgGuestsPerTab).toBeCloseTo(2.5);
    expect(s.engagement.avgItemsPerTab).toBeCloseTo(2);
    expect(s.engagement.paidRate).toBeCloseTo(0.2);
  });

  it('computes scan cost, fail rate, blocked count, and top IPs', () => {
    const tok = { inTok: 1000, outTok: 200 }; // $0.002 per scan
    store.logEvent('receipt_scan', { ipHash: 'aaa', meta: { ok: true, ...tok } }, NOW - 1 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'aaa', meta: { ok: true, ...tok } }, NOW - 2 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'bbb', meta: { ok: false, ...tok } }, NOW - 3 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'ccc', meta: { ok: true, ...tok } }, startOfUtcDay(NOW) - HOUR); // yesterday
    store.logEvent('scan_blocked', { ipHash: 'aaa', meta: { reason: 'ip_hour' } }, NOW - HOUR);
    const { cost } = store.getStats(NOW);
    expect(cost.scansToday).toBe(2);
    expect(cost.blockedToday).toBe(1);
    expect(cost.failRate7d).toBeCloseTo(0.25);
    expect(cost.costTodayUsd).toBeCloseTo(0.006);
    expect(cost.costMonthUsd).toBeCloseTo(0.008);
    expect(cost.topIpsToday).toEqual([{ ipHash: 'aaa', scans: 2 }, { ipHash: 'bbb', scans: 1 }]);
  });

  it('counts tip taps', () => {
    store.logEvent('tip_click', { meta: { amount: 1 } }, NOW - DAY);
    store.logEvent('tip_click', { meta: { amount: 2 } }, NOW - 10 * DAY);
    expect(store.getStats(NOW).tips).toEqual({ last7: 1, allTime: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/stats.test.js --forceExit`
Expected: FAIL — `Cannot find module '../stats'`.

- [ ] **Step 3: Implement** — create `stats.js`:

```js
// Dashboard aggregation over tabs/guests/items/events. Read-only; `now` is
// injected so results are deterministic in tests.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const FOREVER = Number.MAX_SAFE_INTEGER;

// claude-haiku-4-5 list price, USD per million tokens (verified 2026-11-26).
const SCAN_INPUT_USD_PER_MTOK = 1.0;
const SCAN_OUTPUT_USD_PER_MTOK = 5.0;

function startOfUtcDay(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcMonth(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const ratio = (num, den) => (den > 0 ? num / den : null);

// setup.js stores charges.total = subtotal + surcharge + tax + gratuity.
function tabTotal(chargesJson) {
  try {
    const c = JSON.parse(chargesJson);
    if (typeof c.total === 'number') return c.total;
    return (c.subtotal || 0) + (c.surcharge || 0) + (c.tax || 0) + (c.gratuity || 0);
  } catch (e) {
    return 0;
  }
}

function windowTotals(db, from, to) {
  const tabs = db.prepare('SELECT charges FROM tabs WHERE created_at >= ? AND created_at < ?').all(from, to);
  const guests = db.prepare(
    'SELECT COUNT(*) AS n FROM guests g JOIN tabs t ON t.id = g.tab_id WHERE t.created_at >= ? AND t.created_at < ?'
  ).get(from, to).n;
  const split = tabs.reduce((sum, t) => sum + tabTotal(t.charges), 0);
  return { tabs: tabs.length, guests, split: round(split, 2) };
}

function countSince(db, type, since, extraWhere = '') {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ? ${extraWhere}`
  ).get(type, since).n;
}

function scanCostSince(db, since) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(json_extract(meta, '$.inTok')), 0)  AS inTok,
           COALESCE(SUM(json_extract(meta, '$.outTok')), 0) AS outTok
    FROM events WHERE type = 'receipt_scan' AND created_at >= ?
  `).get(since);
  return round((row.inTok * SCAN_INPUT_USD_PER_MTOK + row.outTok * SCAN_OUTPUT_USD_PER_MTOK) / 1e6, 4);
}

function buildStats(db, now) {
  const last7 = windowTotals(db, now - WEEK, now);
  const prev7 = windowTotals(db, now - 2 * WEEK, now - WEEK);
  const all = windowTotals(db, 0, FOREVER);
  const pick = key => ({ last7: last7[key], prev7: prev7[key], allTime: all[key] });

  const weekly = [];
  for (let i = 11; i >= 0; i--) {
    const weekStart = now - (i + 1) * WEEK;
    weekly.push({ weekStart, tabs: windowTotals(db, weekStart, weekStart + WEEK).tabs });
  }

  const created = db.prepare(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(json_extract(meta, '$.scanned')), 0) AS scanned,
           MIN(created_at) AS first
    FROM events WHERE type = 'tab_created'
  `).get();
  const itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const paidCount = db.prepare('SELECT COUNT(*) AS n FROM guests WHERE paid = 1').get().n;

  const today = startOfUtcDay(now);
  const scans7 = db.prepare(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN json_extract(meta, '$.ok') = 1 THEN 0 ELSE 1 END), 0) AS failed
    FROM events WHERE type = 'receipt_scan' AND created_at >= ?
  `).get(now - WEEK);
  const topIpsToday = db.prepare(`
    SELECT ip_hash AS ipHash, COUNT(*) AS scans FROM events
    WHERE type = 'receipt_scan' AND created_at >= ? AND ip_hash IS NOT NULL
    GROUP BY ip_hash ORDER BY scans DESC, ip_hash LIMIT 5
  `).all(today);

  return {
    generatedAt: now,
    scannedSince: created.first ?? null,
    growth: { tabs: pick('tabs'), guests: pick('guests'), split: pick('split'), weekly },
    engagement: {
      scanRate: ratio(created.scanned, created.n),
      avgGuestsPerTab: ratio(all.guests, all.tabs),
      avgItemsPerTab: ratio(itemCount, all.tabs),
      paidRate: ratio(paidCount, all.guests),
    },
    cost: {
      scansToday: countSince(db, 'receipt_scan', today, "AND json_extract(meta, '$.ok') = 1"),
      blockedToday: countSince(db, 'scan_blocked', today),
      failRate7d: ratio(scans7.failed, scans7.n),
      costTodayUsd: scanCostSince(db, today),
      costMonthUsd: scanCostSince(db, startOfUtcMonth(now)),
      topIpsToday,
    },
    tips: { last7: countSince(db, 'tip_click', now - WEEK), allTime: countSince(db, 'tip_click', 0) },
  };
}

module.exports = { buildStats, startOfUtcDay, startOfUtcMonth, SCAN_INPUT_USD_PER_MTOK, SCAN_OUTPUT_USD_PER_MTOK };
```

In `db.js`, add near the top: `const { buildStats } = require('./stats');`. Inside `makeStore`, add:

```js
  function getStats(now = Date.now()) {
    return buildStats(db, now);
  }
```

and add `getStats` to the returned object.

- [ ] **Step 4: Run to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/stats.test.js tests/db.test.js --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add stats.js db.js tests/stats.test.js
git commit -m "feat: add dashboard stats aggregation"
```

---

### Task 3: Log events from existing routes + `scanned` flag

**Files:**
- Modify: `server.js` (top-of-file requires/helpers; `/api/receipt/parse`; `POST /api/tabs`; `POST /api/tabs/:tabId/paid`)
- Modify: `public/js/setup.js` (lines ~10–55 state/draft; ~264 scan success; ~324 create body)
- Test: `tests/server.test.js` (create), `tests/e2e/flow.spec.js` (append)

**Interfaces:**
- Consumes: `store.logEvent`, `store.listEvents` (Task 1).
- Produces (in `server.js`, used by Tasks 4–6):
  - `const store = require('./db')` — module object; new code calls `store.<fn>` so tests can spy on it.
  - `ipHashOf(req): string` (16 hex chars)
  - `track(type: string, req, { tabId?, meta? } = {}): void` — never throws.
- Produces (client → server): `POST /api/tabs` body gains `scanned: boolean`.

- [ ] **Step 1: Write the failing server tests** — create `tests/server.test.js`:

```js
const request = require('supertest');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }))
);

const ENV_KEYS = ['ADMIN_TOKEN', 'IP_SALT', 'TIP_VENMO_HANDLE', 'SCAN_LIMIT_PER_HOUR', 'SCAN_LIMIT_PER_DAY', 'SCANS_DISABLED'];

const SCAN_OK = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      items: [{ name: 'Beer', price: 5, qty: 2 }],
      charges: { surcharge: 0, tax: 1, gratuity: 0 },
      total: 11,
    }),
  }],
  usage: { input_tokens: 1500, output_tokens: 200 },
};

const TAB_BODY = {
  name: 'T', paymentHandle: '@h', paymentPlatform: 'Venmo',
  charges: { subtotal: 10, surcharge: 0, tax: 0, gratuity: 0, total: 10 },
  guests: ['Alice'],
  items: [{ name: 'Beer', price: 10, qty: 1 }],
};

let app, store;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockCreate.mockReset();
  mockCreate.mockResolvedValue(SCAN_OK);
  // Fresh server + fresh in-memory DB per test.
  jest.isolateModules(() => {
    app = require('../server');
    store = require('../db');
  });
});

afterEach(() => jest.restoreAllMocks());

function scan(ip = '1.1.1.1') {
  return request(app)
    .post('/api/receipt/parse')
    .set('Fly-Client-IP', ip)
    .attach('image', Buffer.from('fake'), { filename: 'r.jpg', contentType: 'image/jpeg' });
}

describe('event logging', () => {
  it('logs a successful scan with item count, token usage, and a hashed IP', async () => {
    const res = await scan('9.9.9.9');
    expect(res.status).toBe(200);
    const [e] = store.listEvents('receipt_scan');
    expect(e.meta).toEqual({ ok: true, items: 1, inTok: 1500, outTok: 200 });
    expect(e.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(e.ipHash).not.toContain('9.9.9.9');
  });

  it('logs a failed API call as ok:false with zero tokens', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded'));
    const res = await scan();
    expect(res.status).toBe(400);
    const [e] = store.listEvents('receipt_scan');
    expect(e.meta).toMatchObject({ ok: false, inTok: 0, outTok: 0, error: 'overloaded' });
  });

  it('logs real token usage when the model returns unparseable JSON', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 900, output_tokens: 50 } });
    const res = await scan();
    expect(res.status).toBe(400);
    expect(store.listEvents('receipt_scan')[0].meta).toMatchObject({ ok: false, inTok: 900, outTok: 50 });
  });

  it('logs tab_created with the scanned flag', async () => {
    const a = await request(app).post('/api/tabs').send({ ...TAB_BODY, scanned: true });
    const b = await request(app).post('/api/tabs').send(TAB_BODY);
    const events = store.listEvents('tab_created');
    expect(events.find(e => e.tabId === a.body.tabId).meta).toEqual({ scanned: true });
    expect(events.find(e => e.tabId === b.body.tabId).meta).toEqual({ scanned: false });
  });

  it('logs guest_paid exactly once when Mark Paid is tapped twice', async () => {
    const { body: { tabId } } = await request(app).post('/api/tabs').send(TAB_BODY);
    const guestId = store.getTabView(tabId).guests[0].id;
    await request(app).post(`/api/tabs/${tabId}/paid`).send({ guestId });
    await request(app).post(`/api/tabs/${tabId}/paid`).send({ guestId });
    const events = store.listEvents('guest_paid');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tabId, meta: { guestId } });
  });

  it('logging failures never break tab creation', async () => {
    jest.spyOn(store, 'logEvent').mockImplementation(() => { throw new Error('disk full'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/tabs').send(TAB_BODY);
    expect(res.status).toBe(200);
    expect(res.body.tabId).toHaveLength(6);
  });

  it('hashes the same IP differently with a different IP_SALT', async () => {
    await scan('5.5.5.5');
    process.env.IP_SALT = 'another-salt';
    await scan('5.5.5.5');
    const [second, first] = store.listEvents('receipt_scan');
    expect(second.ipHash).not.toBe(first.ipHash);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: FAIL — `listEvents` returns `[]` (nothing logged yet).

- [ ] **Step 3: Implement server changes** in `server.js`:

Replace line 1 with:

```js
if (!['production', 'test'].includes(process.env.NODE_ENV)) require('dotenv').config();
```

After the existing `require('./db')` destructure, add:

```js
const { createHash, timingSafeEqual } = require('crypto');
// Module object (not destructured) so new event/stats calls can be spied on in tests.
const store = require('./db');
```

After `app.use(express.static(...))`, add:

```js
// Usage events
function ipHashOf(req) {
  const ip = req.get('Fly-Client-IP') || req.ip || 'unknown';
  return createHash('sha256').update((process.env.IP_SALT || 'dev-salt') + ip).digest('hex').slice(0, 16);
}

function track(type, req, { tabId = null, meta = null } = {}) {
  try {
    store.logEvent(type, { tabId, ipHash: ipHashOf(req), meta });
  } catch (err) {
    console.error(`[events] failed to log ${type}:`, err.message);
  }
}

function scanMeta(ok, usage, extra = {}) {
  return { ok, items: 0, inTok: usage?.input_tokens || 0, outTok: usage?.output_tokens || 0, ...extra };
}
```

In `/api/receipt/parse`, keep the `anthropic.messages.create({...})` call and its prompt exactly as they are. Restructure the `try/catch` around it to:

```js
    let usage = null;
    try {
      const response = await anthropic.messages.create({ /* existing args unchanged */ });
      usage = response.usage;
      const raw = response.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      const items = parsed.items || parsed; // fallback if model returns bare array
      const charges = parsed.charges || { surcharge: 0, tax: 0, gratuity: 0 };
      const receiptTotal = parsed.total || null;
      track('receipt_scan', req, { meta: scanMeta(true, usage, { items: Array.isArray(items) ? items.length : 0 }) });
      res.json({ items, charges, receiptTotal });
    } catch (e) {
      track('receipt_scan', req, { meta: scanMeta(false, usage, { error: String(e.message).slice(0, 200) }) });
      res.status(400).json({ error: e.message });
    }
```

In `POST /api/tabs`, after `const tabId = createTab(...)`:

```js
    track('tab_created', req, { tabId, meta: { scanned: req.body.scanned === true } });
```

In `POST /api/tabs/:tabId/paid`, replace `markPaid(req.params.tabId, guestId);` with:

```js
    if (markPaid(req.params.tabId, guestId)) {
      track('guest_paid', req, { tabId: req.params.tabId, meta: { guestId } });
    }
```

- [ ] **Step 4: Run server tests to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing E2E tests** — append to `tests/e2e/flow.spec.js`:

```js
test('tab created from a scanned receipt reports scanned: true', async ({ page }) => {
  await page.route('**/api/receipt/parse', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{ name: 'Nachos', price: 20, qty: 1 }],
      charges: { surcharge: 0, tax: 0, gratuity: 0 },
      receiptTotal: 20,
    }),
  }));
  await page.goto('/');
  await page.setInputFiles('#receipt-library', {
    name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('fake-image-data'),
  });
  await expect(page.locator('#parse-status')).toContainText('Found');
  await page.fill('#tab-name', 'Scanned Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#guest-names', 'Alice');
  const [req] = await Promise.all([
    page.waitForRequest(r => r.url().endsWith('/api/tabs') && r.method() === 'POST'),
    page.click('#create-btn'),
  ]);
  expect(req.postDataJSON().scanned).toBe(true);
});

test('manually entered tab reports scanned: false', async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r => r.url().endsWith('/api/tabs') && r.method() === 'POST'),
    createTab(page),
  ]);
  expect(req.postDataJSON().scanned).toBe(false);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx playwright test --grep "reports scanned"`
Expected: FAIL — `scanned` is `undefined`.

- [ ] **Step 7: Implement in `public/js/setup.js`:**

After `let receiptTotal = null;` add:

```js
let scanned = false; // true once a receipt scan succeeds; reported on tab creation for usage stats
```

In `saveState()`, add `scanned,` after `receiptTotal,` in the object.

In `loadState()`, after the `receiptTotal` line add:

```js
    if (s.scanned)                    scanned = true;
```

In `clearDraft`, after `receiptTotal = null;` add `scanned = false;`.

In the scan success path, directly after `receiptTotal = data.receiptTotal != null ? ...;` add:

```js
    scanned = true;
```

In `createTab`, change the request body to:

```js
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items: itemsToSend, scanned }),
```

- [ ] **Step 8: Run E2E to verify pass**

Run: `npx playwright test`
Expected: PASS (all existing + 2 new).

- [ ] **Step 9: Commit**

```bash
git add server.js public/js/setup.js tests/server.test.js tests/e2e/flow.spec.js
git commit -m "feat: log scan, tab, and payment events"
```

---

### Task 4: Receipt-scan rate limits

**Files:**
- Modify: `server.js` (helpers near `track`; `/api/receipt/parse` route head)
- Test: `tests/server.test.js` (append)

**Interfaces:**
- Consumes: `store.countEvents` (Task 1), `startOfUtcDay` (Task 2), `ipHashOf`, `track` (Task 3).
- Produces: `scanLimits(): { perHour: number, perDay: number }` (used by Task 5).

- [ ] **Step 1: Write the failing tests** — append to `tests/server.test.js`:

```js
describe('scan limits', () => {
  it('blocks the 11th successful scan from one IP within an hour', async () => {
    for (let i = 0; i < 10; i++) expect((await scan('2.2.2.2')).status).toBe(200);
    const res = await scan('2.2.2.2');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("You've scanned a lot of receipts recently — try again in a bit, or enter items manually.");
    expect(mockCreate).toHaveBeenCalledTimes(10);
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'ip_hour' });
  });

  it('does not block a different IP', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '1';
    await scan('3.3.3.3');
    expect((await scan('4.4.4.4')).status).toBe(200);
  });

  it('honors SCAN_LIMIT_PER_HOUR', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    await scan(); await scan();
    expect((await scan()).status).toBe(429);
  });

  it('falls back to the default when SCAN_LIMIT_PER_HOUR is not a positive number', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = 'abc';
    for (let i = 0; i < 10; i++) await scan();
    expect((await scan()).status).toBe(429);
    expect(mockCreate).toHaveBeenCalledTimes(10);
  });

  it('does not count failed scans toward the limit', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    mockCreate.mockRejectedValue(new Error('blurry'));
    for (let i = 0; i < 3; i++) expect((await scan()).status).toBe(400);
    mockCreate.mockResolvedValue(SCAN_OK);
    expect((await scan()).status).toBe(200);
  });

  it('ignores scans older than an hour', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    await scan('6.6.6.6');
    const { ipHash } = store.listEvents('receipt_scan')[0];
    for (let i = 0; i < 5; i++) {
      store.logEvent('receipt_scan', { ipHash, meta: { ok: true } }, Date.now() - 61 * 60 * 1000);
    }
    expect((await scan('6.6.6.6')).status).toBe(200);
  });

  it('enforces the global daily cap across IPs', async () => {
    process.env.SCAN_LIMIT_PER_DAY = '2';
    await scan('7.0.0.1'); await scan('7.0.0.2');
    const res = await scan('7.0.0.3');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Receipt scanning is taking a break right now — you can still enter items manually.');
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'daily_cap' });
  });

  it('SCANS_DISABLED=1 blocks every scan without calling the API', async () => {
    process.env.SCANS_DISABLED = '1';
    const res = await scan();
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'disabled' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: FAIL — 11th scan returns 200.

- [ ] **Step 3: Implement** in `server.js`. Add `const { startOfUtcDay } = require('./stats');` with the other requires. After `scanMeta`, add:

```js
// Receipt-scan limits. Counted from the events table (not memory) because the
// Fly machine auto-stops when idle, which would reset in-memory counters.
const HOUR = 60 * 60 * 1000;
const SCAN_BLOCKED_MESSAGES = {
  ip_hour:   "You've scanned a lot of receipts recently — try again in a bit, or enter items manually.",
  daily_cap: 'Receipt scanning is taking a break right now — you can still enter items manually.',
  disabled:  'Receipt scanning is taking a break right now — you can still enter items manually.',
};

function positiveIntEnv(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return n > 0 ? n : fallback;
}

function scanLimits() {
  return { perHour: positiveIntEnv('SCAN_LIMIT_PER_HOUR', 10), perDay: positiveIntEnv('SCAN_LIMIT_PER_DAY', 500) };
}

function scanBlockReason(ipHash, now = Date.now()) {
  if (process.env.SCANS_DISABLED === '1') return 'disabled';
  const { perHour, perDay } = scanLimits();
  try {
    if (store.countEvents('receipt_scan', { since: now - HOUR, ipHash, okOnly: true }) >= perHour) return 'ip_hour';
    if (store.countEvents('receipt_scan', { since: startOfUtcDay(now), okOnly: true }) >= perDay) return 'daily_cap';
  } catch (err) {
    console.error('[limits] check failed, allowing scan:', err.message);
  }
  return null;
}
```

Change the receipt route's head so the guard runs before multer reads the upload:

```js
app.post('/api/receipt/parse', (req, res, next) => {
  const reason = scanBlockReason(ipHashOf(req));
  if (!reason) return next();
  track('scan_blocked', req, { meta: { reason } });
  res.status(429).json({ error: SCAN_BLOCKED_MESSAGES[reason] });
}, async (req, res) => {
  upload.single('image')(req, res, async (err) => {
    // ...body unchanged from Task 3...
  });
});
```

(No frontend change: `setup.js` already shows `data.error` from a non-OK response.)

- [ ] **Step 4: Run to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "feat: rate-limit receipt scans per IP and per day"
```

---

### Task 5: Admin stats endpoint and dashboard page

**Files:**
- Modify: `server.js` (page route + endpoint)
- Create: `public/admin.html`, `public/js/admin.js`
- Modify: `public/css/app.css` (append admin section)
- Modify: `playwright.config.js` (`webServer.env`)
- Test: `tests/server.test.js` (append), `tests/e2e/flow.spec.js` (append)

**Interfaces:**
- Consumes: `store.getStats(now)` (Task 2), `scanLimits()` (Task 4).
- Produces: `GET /api/admin/stats` → `Stats` (Task 2 shape) plus `cost.scanCap: number`. `GET /admin` → `public/admin.html`.

- [ ] **Step 1: Write the failing server tests** — append to `tests/server.test.js`:

```js
describe('admin stats', () => {
  it('returns 404 when ADMIN_TOKEN is not configured', async () => {
    const res = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(404);
  });

  it('returns 401 without a key, with a wrong key, and with a key of a different length', async () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
    expect((await request(app).get('/api/admin/stats').set('Authorization', 'Bearer secret-token-124')).status).toBe(401);
    expect((await request(app).get('/api/admin/stats').set('Authorization', 'Bearer x')).status).toBe(401);
  });

  it('returns stats with the configured scan cap for the right key', async () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    process.env.SCAN_LIMIT_PER_DAY = '250';
    await request(app).post('/api/tabs').send(TAB_BODY);
    const res = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer secret-token-123');
    expect(res.status).toBe(200);
    expect(res.body.growth.tabs.allTime).toBe(1);
    expect(res.body.growth.weekly).toHaveLength(12);
    expect(res.body.cost.scanCap).toBe(250);
  });

  it('serves the dashboard page at /admin', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="growth"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: FAIL — `/api/admin/stats` 404 for every case; `/admin` 404.

- [ ] **Step 3: Implement server** — in `server.js`, add to the Pages block:

```js
app.get('/admin',       (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
```

Before the `PORT` line, add:

```js
// Admin dashboard (off unless ADMIN_TOKEN is set)
function isAdmin(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) { res.status(404).json({ error: 'Not found' }); return false; }
  const given = Buffer.from((req.get('Authorization') || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/admin/stats', (req, res) => {
  if (!isAdmin(req, res)) return;
  const stats = store.getStats(Date.now());
  stats.cost.scanCap = scanLimits().perDay;
  res.json(stats);
});
```

- [ ] **Step 4: Create `public/admin.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>TabSplitter — Stats</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div class="admin">
    <div class="admin-head">
      <h1>TabSplitter stats</h1>
      <button class="btn btn-outline" id="refresh-btn" onclick="loadStats()">Refresh</button>
    </div>
    <div class="admin-meta" id="admin-meta"></div>
    <div class="admin-message" id="admin-message" hidden></div>
    <div class="admin-grid" id="admin-grid" hidden>
      <section class="admin-card admin-card-wide"><h2>Growth</h2><div id="growth"></div></section>
      <section class="admin-card"><h2>Engagement</h2><div id="engagement"></div></section>
      <section class="admin-card"><h2>Cost &amp; overuse</h2><div id="cost"></div></section>
      <section class="admin-card"><h2>Tips</h2><div id="tips"></div></section>
    </div>
  </div>
  <script src="/js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `public/js/admin.js`:**

```js
const KEY_STORAGE = 'tabsplitter_admin_key';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function apiCost(n) { return n < 1 ? '$' + Number(n).toFixed(3) : money(n); }
function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
function num(n, digits = 0) { return n == null ? '—' : Number(n).toFixed(digits); }

function change(cur, prev) {
  if (!prev) return '<span class="delta">— vs prev 7d</span>';
  const p = Math.round(((cur - prev) / prev) * 100);
  const cls = p > 0 ? 'up' : p < 0 ? 'down' : '';
  const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(p)}% vs prev 7d</span>`;
}

function tile(label, value, extra = '') {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${extra}</div>`;
}

// Key arrives once via ?key=…, is remembered, and is stripped from the address bar.
function readKey() {
  const fromUrl = new URLSearchParams(window.location.search).get('key');
  if (fromUrl) {
    try { localStorage.setItem(KEY_STORAGE, fromUrl); } catch (e) {}
    history.replaceState(null, '', '/admin');
    return fromUrl;
  }
  try { return localStorage.getItem(KEY_STORAGE); } catch (e) { return null; }
}
let adminKey = readKey();

function showMessage(text) {
  document.getElementById('admin-grid').hidden = true;
  const el = document.getElementById('admin-message');
  el.textContent = text;
  el.hidden = false;
}

function weeklyChart(weeks) {
  const W = 320, H = 130, left = 24, bottom = 18, top = 8;
  const max = Math.max(1, ...weeks.map(w => w.tabs));
  const slot = (W - left) / weeks.length;
  const bars = weeks.map((w, i) => {
    const h = (w.tabs / max) * (H - top - bottom);
    const label = `Week of ${new Date(w.weekStart).toLocaleDateString()}: ${w.tabs} tab${w.tabs === 1 ? '' : 's'}`;
    return `<rect x="${(left + i * slot + 2).toFixed(1)}" y="${(H - bottom - h).toFixed(1)}" width="${(slot - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(label)}</title></rect>`;
  }).join('');
  return `
    <figure class="chart">
      <figcaption>Tabs per week · last 12 weeks</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tabs per week, last 12 weeks">
        <line x1="${left}" y1="${H - bottom}" x2="${W}" y2="${H - bottom}" class="axis"/>
        <text x="${left - 4}" y="${top + 8}" text-anchor="end" class="tick">${max}</text>
        <text x="${left - 4}" y="${H - bottom}" text-anchor="end" class="tick">0</text>
        ${bars}
        <text x="${left}" y="${H - 4}" class="tick">12 wks ago</text>
        <text x="${W}" y="${H - 4}" text-anchor="end" class="tick">this week</text>
      </svg>
    </figure>`;
}

function render(s) {
  const { growth: g, engagement: e, cost: c, tips: t } = s;

  document.getElementById('growth').innerHTML = `
    <div class="stat-row">
      ${tile('Tabs · 7d', g.tabs.last7, change(g.tabs.last7, g.tabs.prev7))}
      ${tile('Guests · 7d', g.guests.last7, change(g.guests.last7, g.guests.prev7))}
      ${tile('$ split · 7d', money(g.split.last7), change(g.split.last7, g.split.prev7))}
    </div>
    <div class="admin-note">All-time: ${g.tabs.allTime} tabs · ${g.guests.allTime} guests · ${money(g.split.allTime)} split</div>
    ${weeklyChart(g.weekly)}`;

  const since = s.scannedSince ? `<div class="stat-sub">since ${esc(new Date(s.scannedSince).toLocaleDateString())}</div>` : '';
  document.getElementById('engagement').innerHTML = `
    <div class="stat-row">
      ${tile('Started from scan', pct(e.scanRate), since)}
      ${tile('Avg guests / tab', num(e.avgGuestsPerTab, 1))}
      ${tile('Guests marked paid', pct(e.paidRate))}
      ${tile('Avg items / tab', num(e.avgItemsPerTab, 1))}
    </div>`;

  const used = Math.min(100, Math.round((c.scansToday / c.scanCap) * 100));
  const ips = c.topIpsToday.length
    ? `<ul class="ip-list">${c.topIpsToday.map(r => `<li><code>${esc(r.ipHash.slice(0, 8))}…</code><span>${r.scans}</span></li>`).join('')}</ul>`
    : '<div class="admin-note">No scans yet today.</div>';
  document.getElementById('cost').innerHTML = `
    <div class="meter-label"><span>Scans today (UTC)</span><span>${c.scansToday} / ${c.scanCap}</span></div>
    <div class="meter"><div class="meter-fill ${used >= 80 ? 'hot' : ''}" style="width:${used}%"></div></div>
    <div class="stat-row">
      ${tile('Blocked today', c.blockedToday)}
      ${tile('Fail rate · 7d', pct(c.failRate7d))}
      ${tile('API cost today', apiCost(c.costTodayUsd))}
      ${tile('API cost this month', apiCost(c.costMonthUsd))}
    </div>
    <div class="admin-subhead">Top IPs today (hashed)</div>
    ${ips}`;

  document.getElementById('tips').innerHTML = `
    <div class="stat-row">
      ${tile('Tip taps · 7d', t.last7)}
      ${tile('Tip taps · all time', t.allTime)}
    </div>
    <div class="admin-note">Taps, not payments — check Venmo for what actually came in.</div>`;

  document.getElementById('admin-meta').textContent = `Updated ${new Date(s.generatedAt).toLocaleTimeString()}`;
  document.getElementById('admin-message').hidden = true;
  document.getElementById('admin-grid').hidden = false;
}

window.loadStats = function () {
  if (!adminKey) return showMessage('Open this page once with ?key=YOUR_ADMIN_TOKEN to sign in.');
  fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${adminKey}` } })
    .then(res => {
      if (res.status === 401) {
        try { localStorage.removeItem(KEY_STORAGE); } catch (e) {}
        adminKey = null;
        throw new Error('That key was not accepted. Open this page again with ?key=YOUR_ADMIN_TOKEN.');
      }
      if (res.status === 404) throw new Error('The dashboard is turned off (ADMIN_TOKEN is not set on the server).');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      return res.json();
    })
    .then(render)
    .catch(err => showMessage(err.message));
};

loadStats();
```

- [ ] **Step 6: Append admin styles to `public/css/app.css`:**

```css
/* Admin dashboard */
.admin { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
.admin-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.admin-head h1 { font-size: 20px; }
.admin-meta { color: var(--muted); font-size: 12px; margin: 4px 0 16px; }
.admin-message {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; color: var(--muted);
}
.admin-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
.admin-grid[hidden], .admin-message[hidden] { display: none; }
@media (min-width: 760px) {
  .admin-grid { grid-template-columns: 1fr 1fr; }
  .admin-card-wide { grid-column: 1 / -1; }
}
.admin-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px; min-width: 0;
}
.admin-card h2 {
  font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 12px;
}
.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.stat-label { font-size: 12px; color: var(--muted); }
.stat-value { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat-sub, .admin-note, .delta { font-size: 12px; color: var(--muted); }
.admin-note { margin-top: 12px; }
.admin-subhead { font-size: 12px; font-weight: 600; margin: 16px 0 6px; }
.delta.up { color: var(--green); }
.delta.down { color: #b45309; }
.meter-label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.meter { height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; margin-bottom: 16px; }
.meter-fill { height: 100%; background: var(--green); }
.meter-fill.hot { background: #b45309; }
.ip-list { list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.ip-list li { display: flex; justify-content: space-between; }
.chart { margin-top: 16px; }
.chart figcaption { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.chart svg { width: 100%; height: auto; display: block; }
.chart rect { fill: var(--green); }
.chart .axis { stroke: var(--border); }
.chart .tick { font-size: 9px; fill: var(--muted); }
```

- [ ] **Step 7: Run server tests to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/server.test.js --forceExit`
Expected: PASS.

- [ ] **Step 8: Write E2E tests** — in `playwright.config.js` add to `webServer.env`:

```js
        ADMIN_TOKEN: 'e2e-admin-token',
        TIP_VENMO_HANDLE: 'Caleb-Holland-3',
```

Append to `tests/e2e/flow.spec.js`:

```js
test.describe('admin dashboard', () => {
  test.skip(!!process.env.BASE_URL, 'needs the local test server env');

  test('signs in via ?key=, strips it from the URL, and renders stats', async ({ page }) => {
    await createTab(page);
    await page.goto('/admin?key=e2e-admin-token');
    await expect(page.locator('#admin-grid')).toBeVisible();
    await expect(page.locator('#growth')).toContainText('Tabs · 7d');
    await expect(page.locator('#cost')).toContainText('/ 500');
    expect(page.url()).not.toContain('key=');
    await page.reload(); // remembered key
    await expect(page.locator('#admin-grid')).toBeVisible();
  });

  test('shows a message and hides stats for a wrong key', async ({ page }) => {
    await page.goto('/admin?key=wrong');
    await expect(page.locator('#admin-message')).toContainText('not accepted');
    await expect(page.locator('#admin-grid')).toBeHidden();
  });
});
```

- [ ] **Step 9: Run E2E**

Run: `npx playwright test --grep "admin dashboard"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server.js public/admin.html public/js/admin.js public/css/app.css playwright.config.js tests/server.test.js tests/e2e/flow.spec.js
git commit -m "feat: add token-protected admin usage dashboard"
```

---

### Task 6: Tip button on the host page

**Files:**
- Create: `public/js/venmo.js`, `tests/venmo.test.js`
- Modify: `public/js/tab.js` (remove lines 10–18: `isMobile` + `venmoUrl`), `public/tab.html` (script tag)
- Modify: `public/host.html`, `public/js/host.js`, `public/css/app.css`
- Modify: `server.js` (`/api/config`, `/api/events/tip`)
- Test: `tests/server.test.js`, `tests/e2e/flow.spec.js` (append)

**Interfaces:**
- Consumes: `track`, `ipHashOf` (Task 3); `getTabView` (existing).
- Produces:
  - Browser global + CommonJS export `venmoUrl(handle: string, amount: number|null|undefined, note: string, mobile: boolean = isMobile): string`
  - `GET /api/config` → `{ tipHandle: string|null }`
  - `POST /api/events/tip` body `{ tabId: string, amount: 1|2|"other" }` → 204, or 400

- [ ] **Step 1: Write failing unit tests** — create `tests/venmo.test.js`:

```js
const { venmoUrl } = require('../public/js/venmo');

describe('venmoUrl', () => {
  it('opens the profile page on desktop regardless of amount', () => {
    expect(venmoUrl('@Caleb-Holland-3', 1, 'TabSplitter tip', false)).toBe('https://venmo.com/u/Caleb-Holland-3');
  });

  it('builds a deep link with amount and note on mobile', () => {
    expect(venmoUrl('Caleb-Holland-3', 1, 'TabSplitter tip', true))
      .toBe('venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&amount=1.00&note=TabSplitter%20tip');
  });

  it('omits the amount when it is null (the "Other" tip)', () => {
    expect(venmoUrl('Caleb-Holland-3', null, 'TabSplitter tip', true))
      .toBe('venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&note=TabSplitter%20tip');
  });

  it('keeps amount=0.00 for a zero amount (existing guest badge behavior)', () => {
    expect(venmoUrl('@host', 0, 'Dinner', true)).toContain('&amount=0.00&');
  });
});
```

- [ ] **Step 2: Write failing server tests** — append to `tests/server.test.js`:

```js
describe('tips', () => {
  it('exposes the tip handle via /api/config (null when unset)', async () => {
    expect((await request(app).get('/api/config')).body).toEqual({ tipHandle: null });
    process.env.TIP_VENMO_HANDLE = 'Caleb-Holland-3';
    expect((await request(app).get('/api/config')).body).toEqual({ tipHandle: 'Caleb-Holland-3' });
  });

  it('logs a tip tap for a valid amount and tab', async () => {
    const { body: { tabId } } = await request(app).post('/api/tabs').send(TAB_BODY);
    for (const amount of [1, 2, 'other']) {
      expect((await request(app).post('/api/events/tip').send({ tabId, amount })).status).toBe(204);
    }
    expect(store.listEvents('tip_click').map(e => e.meta.amount)).toEqual(['other', 2, 1]);
  });

  it('rejects bad amounts and unknown tabs without logging', async () => {
    const { body: { tabId } } = await request(app).post('/api/tabs').send(TAB_BODY);
    for (const body of [{ tabId, amount: 3 }, { tabId, amount: '1' }, { tabId }, { tabId: 'nope00', amount: 1 }, {}]) {
      expect((await request(app).post('/api/events/tip').send(body)).status).toBe(400);
    }
    expect(store.listEvents('tip_click')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/venmo.test.js tests/server.test.js --forceExit`
Expected: FAIL — `Cannot find module '../public/js/venmo'`; `/api/config` 404.

- [ ] **Step 4: Create `public/js/venmo.js`:**

```js
// Shared by the guest page (pay the host) and the host page (tip jar).
const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Mobile gets a deep link that pre-fills the pay screen; desktop can only open the profile.
// A null/undefined amount leaves the amount blank for the payer to fill in.
function venmoUrl(handle, amount, note, mobile = isMobile) {
  const h = handle.replace(/^@/, '');
  if (mobile) {
    const amt = amount == null ? '' : `&amount=${Number(amount).toFixed(2)}`;
    return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(h)}${amt}&note=${encodeURIComponent(note)}`;
  }
  return `https://venmo.com/u/${encodeURIComponent(h)}`;
}

if (typeof module !== 'undefined') module.exports = { venmoUrl };
```

In `public/js/tab.js`, delete the `const isMobile = …` line and the whole `function venmoUrl(...) { ... }` (lines 10–18). In `public/tab.html`, add before `<script src="/js/tab.js"></script>`:

```html
  <script src="/js/venmo.js"></script>
```

- [ ] **Step 5: Add server endpoints** — in `server.js`, before the admin section:

```js
// Public client config
app.get('/api/config', (req, res) => {
  res.json({ tipHandle: process.env.TIP_VENMO_HANDLE || null });
});

// Tip button taps (sent with navigator.sendBeacon from the host page)
const TIP_AMOUNTS = [1, 2, 'other'];
app.post('/api/events/tip', (req, res) => {
  const { tabId, amount } = req.body || {};
  if (!TIP_AMOUNTS.includes(amount) || typeof tabId !== 'string' || !getTabView(tabId)) {
    return res.status(400).json({ error: 'Invalid tip event' });
  }
  track('tip_click', req, { tabId, meta: { amount } });
  res.status(204).end();
});
```

- [ ] **Step 6: Run unit tests to verify pass**

Run: `DB_PATH=:memory: NODE_ENV=test npx jest tests/venmo.test.js tests/server.test.js --forceExit`
Expected: PASS.

- [ ] **Step 7: Write failing E2E tests** — append to `tests/e2e/flow.spec.js`:

```js
test.describe('tip row', () => {
  test('shows $1 / $2 / Other linking to the tip Venmo profile on desktop', async ({ page }) => {
    await createTab(page);
    const row = page.locator('#tip-row');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Leave a tip!');
    await expect(row.locator('[data-amount="1"]')).toHaveAttribute('href', 'https://venmo.com/u/Caleb-Holland-3');
    await expect(row.locator('[data-amount="other"]')).toHaveText('Other');
  });

  test('records a tip tap', async ({ page }) => {
    await page.route('https://venmo.com/**', route => route.fulfill({ status: 200, body: 'venmo' }));
    await createTab(page);
    const [req] = await Promise.all([
      page.waitForRequest(r => r.url().endsWith('/api/events/tip')),
      page.locator('#tip-row [data-amount="2"]').click(),
    ]);
    expect(JSON.parse(req.postData())).toMatchObject({ amount: 2 });
  });

  test('tip row stays hidden when no handle is configured', async ({ page }) => {
    await page.route('**/api/config', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ tipHandle: null }),
    }));
    await createTab(page);
    await expect(page.locator('#guest-url')).toContainText('/tab/');
    await expect(page.locator('#tip-row')).toBeHidden();
  });
});

test.describe('tip row on mobile', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });

  test('deep-links into the Venmo app with the amount pre-filled', async ({ page }) => {
    // Create via API: the setup form's keypad behaves differently under a mobile UA.
    const res = await page.request.post('/api/tabs', { data: {
      name: 'Mobile Tab', paymentHandle: '@tester', paymentPlatform: 'Venmo',
      charges: { subtotal: 10, surcharge: 0, tax: 0, gratuity: 0, total: 10 },
      guests: ['Alice'], items: [{ name: 'Beer', price: 10, qty: 1 }],
    } });
    const { tabId } = await res.json();
    await page.goto(`/host/${tabId}`);
    await expect(page.locator('#tip-row [data-amount="1"]'))
      .toHaveAttribute('href', 'venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&amount=1.00&note=TabSplitter%20tip');
    await expect(page.locator('#tip-row [data-amount="other"]'))
      .toHaveAttribute('href', 'venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&note=TabSplitter%20tip');
  });
});
```

- [ ] **Step 8: Run to verify failure**

Run: `npx playwright test --grep "tip row"`
Expected: FAIL — `#tip-row` not found.

- [ ] **Step 9: Implement host UI** — in `public/host.html`, insert directly after the closing `</div>` of `.share-box`:

```html
    <div class="tip-row" id="tip-row" hidden>
      <div>
        <div class="tip-label">Leave a tip!</div>
        <div class="tip-sub">Tips go to the person who built TabSplitter.</div>
      </div>
      <div class="tip-buttons">
        <a class="btn btn-outline tip-btn" data-amount="1">$1</a>
        <a class="btn btn-outline tip-btn" data-amount="2">$2</a>
        <a class="btn btn-outline tip-btn" data-amount="other">Other</a>
      </div>
    </div>
```

and replace `<script src="/js/host.js"></script>` with:

```html
  <script src="/js/venmo.js"></script>
  <script src="/js/host.js"></script>
```

Append to `public/js/host.js` (after `pollInterval = setInterval(poll, 2000);`):

```js
const TIP_NOTE = 'TabSplitter tip';

function setupTips() {
  fetch('/api/config')
    .then(r => r.json())
    .then(({ tipHandle }) => {
      if (!tipHandle) return;
      document.querySelectorAll('#tip-row .tip-btn').forEach(link => {
        const amount = link.dataset.amount === 'other' ? null : Number(link.dataset.amount);
        link.href = venmoUrl(tipHandle, amount, TIP_NOTE);
        link.addEventListener('click', () => {
          const body = JSON.stringify({ tabId, amount: amount ?? 'other' });
          try { navigator.sendBeacon('/api/events/tip', new Blob([body], { type: 'application/json' })); } catch (e) {}
        });
      });
      document.getElementById('tip-row').hidden = false;
    })
    .catch(() => {});
}
setupTips();
```

Append to `public/css/app.css`:

```css
/* Tip row (host page) */
.tip-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  margin: -8px 0 20px; padding: 10px 14px;
  border: 1px dashed var(--border); border-radius: 10px;
}
.tip-row[hidden] { display: none; }
.tip-label { font-size: 13px; font-weight: 600; }
.tip-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.tip-buttons { display: flex; gap: 8px; }
.tip-btn { text-decoration: none; min-width: 52px; text-align: center; }
```

- [ ] **Step 10: Run all tests**

Run: `npm test && npx playwright test`
Expected: PASS (existing guest Venmo-button tests still pass with the moved `venmoUrl`).

- [ ] **Step 11: Commit**

```bash
git add public/js/venmo.js public/js/tab.js public/tab.html public/host.html public/js/host.js public/css/app.css server.js tests/venmo.test.js tests/server.test.js tests/e2e/flow.spec.js
git commit -m "feat: add Venmo tip row to the host page"
```

---

### Task 7: Config, docs, and full verification

**Files:**
- Modify: `fly.toml` (`[env]`), `CLAUDE.md`

- [ ] **Step 1: Add the tip handle to `fly.toml`** under `[env]`:

```toml
  TIP_VENMO_HANDLE = "Caleb-Holland-3"
```

- [ ] **Step 2: Update `CLAUDE.md`.** In the Architecture intro, change "Three-page app" to:

```markdown
Three-page app: **setup** (`/`) → **host monitor** (`/host/:tabId`) → **guest tab** (`/tab/:tabId`), plus a private **admin dashboard** (`/admin`).
```

Add under the Backend bullets:

```markdown
- `events` table logs `receipt_scan`, `scan_blocked`, `tab_created`, `guest_paid`, `tip_click` (IP stored only as a salted 16-char hash). `stats.js` aggregates it plus tabs/guests/items for `GET /api/admin/stats`.
- Receipt scans are rate-limited by counting `events` rows (not memory — the Fly machine auto-stops): `SCAN_LIMIT_PER_HOUR` per IP (default 10), `SCAN_LIMIT_PER_DAY` global (default 500, UTC day), `SCANS_DISABLED=1` kill switch. Blocked → 429.
```

Add under the Frontend bullets:

```markdown
- `public/js/admin.js` — dashboard; key passed once as `/admin?key=…`, stored in `localStorage` (`tabsplitter_admin_key`), sent as `Authorization: Bearer`.
- `public/js/venmo.js` — shared `venmoUrl()` used by `tab.js` (guest payment) and `host.js` (tip row, shown only when `TIP_VENMO_HANDLE` is set).
```

Replace the **Required env var** paragraph with:

```markdown
**Env vars:** `ANTHROPIC_API_KEY` is required for receipt scanning (`/api/receipt/parse`). Optional: `ADMIN_TOKEN` (enables `/admin`; 404 when unset), `IP_SALT` (IP hashing), `TIP_VENMO_HANDLE` (tip row; set in `fly.toml`), `SCAN_LIMIT_PER_HOUR`, `SCAN_LIMIT_PER_DAY`, `SCANS_DISABLED`. `dotenv` is skipped when `NODE_ENV` is `production` or `test`.
```

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all suites PASS (`calc`, `db`, `stats`, `server`, `venmo`).

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 4: Manual smoke check**

Run: `ADMIN_TOKEN=dev TIP_VENMO_HANDLE=Caleb-Holland-3 npm run dev`, create a tab at `http://localhost:3000`, confirm the tip row appears on the host page, then open `http://localhost:3000/admin?key=dev` and confirm the tab shows in Growth. Check the dashboard at ~400px width (single column, no horizontal scroll).

- [ ] **Step 5: Commit**

```bash
git add fly.toml CLAUDE.md
git commit -m "docs: document dashboard, scan limits, and tip config"
```

## Rollout (after merge — owner actions, not part of the code tasks)

1. `fly secrets set ADMIN_TOKEN=$(openssl rand -hex 32) IP_SALT=$(openssl rand -hex 32)` — save the ADMIN_TOKEN value somewhere safe.
2. Set a monthly spend limit in the Anthropic console.
3. Bookmark `https://splityourtab.com/admin?key=<ADMIN_TOKEN>` on your phone (open once; the key is then remembered).
