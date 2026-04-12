# TabSplitter v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade TabSplitter from a hardcoded single-tab app to a multi-tab receipt-splitting tool with SQLite persistence, Claude vision receipt parsing, a setup page, and unique tab URLs.

**Architecture:** Node.js + Express with `better-sqlite3` for persistent SQLite storage replacing the in-memory tabStore. Receipt photos are sent to Claude Haiku API which returns structured JSON; the host edits the result before creating the tab. Each tab gets a unique 6-char slug URL. Client-side 2-second polling is unchanged.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3 ^9.4.3, @anthropic-ai/sdk ^0.39.0, multer ^1.4.5-lts.1, @playwright/test ^1.44.0, Jest 29, Railway

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `db.js` | Create | SQLite layer — replaces tabStore.js |
| `server.js` | Rewrite | Express routes with :tabId params, receipt parse, tab create |
| `tabStore.js` | Delete | Replaced by db.js |
| `public/index.html` | Create | Setup page (receipt upload + tab creation form) |
| `public/js/setup.js` | Create | Setup page logic |
| `public/host.html` | Modify | Read tabId from URL, update API calls |
| `public/js/host.js` | Modify | Poll `/api/tabs/:tabId` instead of `/api/tab` |
| `public/tab.html` | Modify | Read tabId from URL, update API calls |
| `public/js/tab.js` | Modify | Mutation endpoints include tabId |
| `public/css/app.css` | Modify | Add setup page styles |
| `tests/db.test.js` | Create | Jest unit tests for db.js using :memory: SQLite |
| `tests/tabStore.test.js` | Delete | Replaced by db.test.js |
| `tests/e2e/flow.spec.js` | Create | Playwright E2E tests |
| `playwright.config.js` | Create | Playwright config with webServer |
| `package.json` | Modify | Add new deps, add test:e2e script |
| `.gitignore` | Modify | Ignore tabsplitter.db files |

---

## Task 1: SQLite Layer (db.js)

**Files:**
- Create: `db.js`
- Create: `tests/db.test.js`
- Delete: `tabStore.js`
- Delete: `tests/tabStore.test.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install --save-dev @playwright/test
```

Expected: `node_modules/better-sqlite3` exists, no errors.

- [ ] **Step 2: Update package.json scripts and add playwright**

Replace the contents of `package.json` with:

```json
{
  "name": "tab-splitter",
  "version": "2.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "jest --forceExit --testPathIgnorePatterns=tests/e2e",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "express": "^4.19.2",
    "better-sqlite3": "^9.4.3",
    "@anthropic-ai/sdk": "^0.39.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "dotenv": "^16.4.5",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "@playwright/test": "^1.44.0"
  }
}
```

- [ ] **Step 3: Install all dependencies**

```bash
npm install
```

Expected: `node_modules/@anthropic-ai`, `node_modules/multer` present.

- [ ] **Step 4: Add tabsplitter.db to .gitignore**

Read `.gitignore`. If it doesn't exist, create it. Add these lines at the end:

```
tabsplitter.db
tabsplitter.db-wal
tabsplitter.db-shm
.env
```

- [ ] **Step 5: Write the failing tests in tests/db.test.js**

```js
const { buildDb, makeStore } = require('../db');

const SAMPLE_TAB = {
  name: 'Test Tab',
  paymentHandle: '@test',
  paymentPlatform: 'Venmo',
  charges: { subtotal: 20.00, surcharge: 0, tax: 1.60, gratuity: 4.00, total: 25.60 },
  guests: ['Alice', 'Bob'],
  items: [
    { name: 'Beer', price: 5.00, qty: 2 },
    { name: 'Wings', price: 10.00, qty: 1 },
  ],
};

let store;

beforeEach(() => {
  store = makeStore(buildDb(':memory:'));
});

describe('createTab', () => {
  it('returns a 6-char tab id', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    expect(typeof tabId).toBe('string');
    expect(tabId).toHaveLength(6);
  });

  it('expands qty into individual items', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    // 2 Beers + 1 Wings = 3 items
    expect(view.items).toHaveLength(3);
  });

  it('creates the correct number of guests', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(view.guests).toHaveLength(2);
    expect(view.guests.map(g => g.name)).toEqual(['Alice', 'Bob']);
  });
});

describe('getTabView', () => {
  it('returns null for unknown tabId', () => {
    expect(store.getTabView('nope00')).toBeNull();
  });

  it('returns correct shape', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(view.id).toBe(tabId);
    expect(view.name).toBe('Test Tab');
    expect(view.status).toBe('open');
    expect(view.payment).toEqual({ handle: '@test', platform: 'Venmo' });
    expect(view.charges.total).toBe(25.60);
  });

  it('returns subtotal and owed as 0 for guests with no claims', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    for (const g of view.guests) {
      expect(g.subtotal).toBe(0);
      expect(g.owed).toBe(0);
    }
  });

  it('calculates owed proportionally', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const alice = view.guests[0];
    const beer = view.items.find(i => i.name === 'Beer');
    store.claimItem(tabId, beer.id, alice.id);
    const view2 = store.getTabView(tabId);
    const aliceView = view2.guests.find(g => g.name === 'Alice');
    // subtotal=5, total=25.60, multiplier=25.60/20=1.28, owed=5*1.28=6.40
    expect(aliceView.subtotal).toBe(5.00);
    expect(aliceView.owed).toBeCloseTo(6.40, 2);
  });
});

describe('claimItem', () => {
  it('assigns an unclaimed item to a guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    const guest = view.guests[0];
    expect(store.claimItem(tabId, item.id, guest.id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.items.find(i => i.id === item.id).claimedBy).toBe(guest.id);
  });

  it('rejects claiming an already-claimed item', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    store.claimItem(tabId, item.id, view.guests[0].id);
    expect(store.claimItem(tabId, item.id, view.guests[1].id)).toBe(false);
  });

  it('rejects guest from a different tab', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const tabId2 = store.createTab(SAMPLE_TAB);
    const view1 = store.getTabView(tabId);
    const view2 = store.getTabView(tabId2);
    expect(store.claimItem(tabId, view1.items[0].id, view2.guests[0].id)).toBe(false);
  });
});

describe('unclaimItem', () => {
  it('removes a claim by the same guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    const guest = view.guests[0];
    store.claimItem(tabId, item.id, guest.id);
    expect(store.unclaimItem(tabId, item.id, guest.id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.items.find(i => i.id === item.id).claimedBy).toBeNull();
  });

  it('rejects unclaim by a different guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    store.claimItem(tabId, item.id, view.guests[0].id);
    expect(store.unclaimItem(tabId, item.id, view.guests[1].id)).toBe(false);
  });
});

describe('markPaid and isSettled', () => {
  it('marks a guest paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(store.markPaid(tabId, view.guests[0].id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.guests[0].paid).toBe(true);
  });

  it('is idempotent on double-pay', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    store.markPaid(tabId, view.guests[0].id);
    expect(store.markPaid(tabId, view.guests[0].id)).toBe(false);
  });

  it('is not settled until all guests paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    store.markPaid(tabId, view.guests[0].id);
    expect(store.isSettled(tabId)).toBe(false);
  });

  it('is settled when all guests paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    for (const g of view.guests) store.markPaid(tabId, g.id);
    expect(store.isSettled(tabId)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.status).toBe('settled');
  });
});
```

- [ ] **Step 6: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../db'`

- [ ] **Step 7: Create db.js**

```js
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');
const path = require('path');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payment_handle TEXT NOT NULL,
    payment_platform TEXT NOT NULL,
    charges TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL REFERENCES tabs(id),
    name TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL REFERENCES tabs(id),
    name TEXT NOT NULL,
    price REAL NOT NULL,
    claimed_by TEXT REFERENCES guests(id)
  );
`;

function shortId() { return randomBytes(3).toString('hex'); }
function longId()  { return randomBytes(4).toString('hex'); }

function buildDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

function makeStore(db) {
  function createTab({ name, paymentHandle, paymentPlatform, charges, guests, items }) {
    const tabId = shortId();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO tabs (id, name, payment_handle, payment_platform, charges, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(tabId, name, paymentHandle, paymentPlatform, JSON.stringify(charges), Date.now());
      for (const guestName of guests) {
        db.prepare('INSERT INTO guests (id, tab_id, name) VALUES (?, ?, ?)').run(longId(), tabId, guestName);
      }
      for (const { name: itemName, price, qty } of items) {
        for (let i = 0; i < qty; i++) {
          db.prepare('INSERT INTO items (id, tab_id, name, price) VALUES (?, ?, ?, ?)').run(longId(), tabId, itemName, price);
        }
      }
    })();
    return tabId;
  }

  function getTabView(tabId) {
    const tab = db.prepare('SELECT * FROM tabs WHERE id = ?').get(tabId);
    if (!tab) return null;
    const charges = JSON.parse(tab.charges);
    const guests = db.prepare('SELECT * FROM guests WHERE tab_id = ?').all(tabId);
    const items  = db.prepare('SELECT * FROM items  WHERE tab_id = ?').all(tabId);
    const multiplier = charges.subtotal > 0 ? charges.total / charges.subtotal : 0;
    return {
      id: tab.id,
      name: tab.name,
      status: tab.status,
      payment: { handle: tab.payment_handle, platform: tab.payment_platform },
      charges,
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, claimedBy: i.claimed_by })),
      guests: guests.map(g => {
        const guestSubtotal = items.filter(i => i.claimed_by === g.id).reduce((s, i) => s + i.price, 0);
        return {
          id: g.id,
          name: g.name,
          paid: g.paid === 1,
          subtotal: Math.round(guestSubtotal * 100) / 100,
          owed: Math.round(guestSubtotal * multiplier * 100) / 100,
        };
      }),
    };
  }

  function claimItem(tabId, itemId, guestId) {
    const item  = db.prepare('SELECT * FROM items  WHERE id = ? AND tab_id = ?').get(itemId, tabId);
    if (!item || item.claimed_by !== null) return false;
    const guest = db.prepare('SELECT id  FROM guests WHERE id = ? AND tab_id = ?').get(guestId, tabId);
    if (!guest) return false;
    db.prepare('UPDATE items SET claimed_by = ? WHERE id = ?').run(guestId, itemId);
    return true;
  }

  function unclaimItem(tabId, itemId, guestId) {
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND tab_id = ?').get(itemId, tabId);
    if (!item || item.claimed_by !== guestId) return false;
    db.prepare('UPDATE items SET claimed_by = NULL WHERE id = ?').run(itemId);
    return true;
  }

  function isSettled(tabId) {
    const row = db.prepare(
      'SELECT COUNT(*) as count, SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) as unpaid FROM guests WHERE tab_id = ?'
    ).get(tabId);
    return row.count > 0 && row.unpaid === 0;
  }

  function markPaid(tabId, guestId) {
    const guest = db.prepare('SELECT * FROM guests WHERE id = ? AND tab_id = ?').get(guestId, tabId);
    if (!guest || guest.paid) return false;
    db.prepare('UPDATE guests SET paid = 1 WHERE id = ?').run(guestId);
    if (isSettled(tabId)) db.prepare("UPDATE tabs SET status = 'settled' WHERE id = ?").run(tabId);
    return true;
  }

  return { createTab, getTabView, claimItem, unclaimItem, markPaid, isSettled };
}

const productionDb = buildDb(process.env.DB_PATH || path.join(__dirname, 'tabsplitter.db'));
module.exports = { buildDb, makeStore, ...makeStore(productionDb) };
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
npm test
```

Expected: All tests in `tests/db.test.js` pass. `tests/tabStore.test.js` still runs — ignore its failures for now.

- [ ] **Step 9: Delete tabStore.js and tests/tabStore.test.js**

```bash
rm tabStore.js tests/tabStore.test.js
```

- [ ] **Step 10: Run tests again to confirm clean pass**

```bash
npm test
```

Expected: All db.test.js tests pass, no other test files, no errors.

- [ ] **Step 11: Commit**

```bash
git add db.js tests/db.test.js package.json package-lock.json .gitignore
git rm tabStore.js tests/tabStore.test.js
git commit -m "feat: replace in-memory tabStore with SQLite db.js"
```

---

## Task 2: Server Rewrite

**Files:**
- Rewrite: `server.js`

- [ ] **Step 1: Install remaining dependencies**

```bash
npm install @anthropic-ai/sdk multer
```

Expected: `node_modules/@anthropic-ai` and `node_modules/multer` present.

- [ ] **Step 2: Rewrite server.js**

```js
require('dotenv').config();
const express = require('express');
const path    = require('path');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const {
  createTab, getTabView, claimItem, unclaimItem, markPaid, isSettled,
} = require('./db');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pages
app.get('/',           (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/host/:tabId', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab/:tabId',  (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));

// Receipt parsing
app.post('/api/receipt/parse', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: req.file.mimetype,
              data: req.file.buffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: 'Extract all line items from this receipt. Return ONLY a JSON array with no markdown: [{"name": string, "price": number, "qty": number}]. Each unique item type is one entry. If a line says "3 @ $6.50" that is qty=3, price=6.50. Do not include subtotals, taxes, tips, or totals.',
          },
        ],
      }],
    });
    const items = JSON.parse(response.content[0].text.trim());
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create tab
app.post('/api/tabs', (req, res) => {
  const { name, paymentHandle, paymentPlatform, charges, guests, items } = req.body || {};
  try {
    const tabId = createTab({ name, paymentHandle, paymentPlatform, charges, guests, items });
    res.json({ tabId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get tab state
app.get('/api/tabs/:tabId', (req, res) => {
  const view = getTabView(req.params.tabId);
  if (!view) return res.status(404).json({ error: 'Tab not found' });
  res.json(view);
});

// Claim item
app.post('/api/tabs/:tabId/claim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    claimItem(req.params.tabId, itemId, guestId);
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Unclaim item
app.post('/api/tabs/:tabId/unclaim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    unclaimItem(req.params.tabId, itemId, guestId);
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark paid
app.post('/api/tabs/:tabId/paid', (req, res) => {
  const { guestId } = req.body || {};
  try {
    markPaid(req.params.tabId, guestId);
    res.json({ tab: getTabView(req.params.tabId), settled: isSettled(req.params.tabId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = app;
```

- [ ] **Step 3: Smoke-test the server starts**

```bash
node server.js &
sleep 1
curl http://localhost:3000/api/tabs/notfound
kill %1
```

Expected: `{"error":"Tab not found"}`

- [ ] **Step 4: Commit**

```bash
git add server.js package-lock.json
git commit -m "feat: rewrite server with tabId routes, receipt parse, tab create endpoints"
```

---

## Task 3: Setup Page

**Files:**
- Create: `public/index.html`
- Create: `public/js/setup.js`
- Modify: `public/css/app.css`

- [ ] **Step 1: Create public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TabSplitter — New Tab</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div class="app">
    <div class="header">
      <h1>TabSplitter</h1>
      <div class="meta">Create a new tab</div>
    </div>

    <div class="section-label">RECEIPT</div>
    <div class="setup-card">
      <label class="upload-btn" for="receipt-upload">
        📷 Scan Receipt with AI
        <input type="file" id="receipt-upload" accept="image/*" capture="environment" style="display:none">
      </label>
      <div id="parse-status" class="parse-status"></div>
    </div>

    <div class="section-label">ITEMS</div>
    <div id="item-editor"></div>
    <div style="padding: 8px 20px 16px;">
      <button class="btn btn-outline" onclick="addItem()">+ Add Item</button>
    </div>

    <div class="section-label">TAB DETAILS</div>
    <div class="setup-card">
      <div class="setup-field">
        <label class="setup-label">Tab Name</label>
        <input id="tab-name" class="setup-input" placeholder="e.g. Kirkwood Tab 4/12" type="text">
      </div>
      <div class="setup-field">
        <label class="setup-label">Payment Handle</label>
        <input id="payment-handle" class="setup-input" placeholder="e.g. @Caleb-Holland-3" type="text">
      </div>
      <div class="setup-field">
        <label class="setup-label">Platform</label>
        <input id="payment-platform" class="setup-input" placeholder="Venmo" type="text" value="Venmo">
      </div>
    </div>

    <div class="section-label">FEES (from receipt)</div>
    <div class="setup-card">
      <div class="setup-row">
        <div class="setup-field">
          <label class="setup-label">Surcharge ($)</label>
          <input id="charge-surcharge" class="setup-input" type="number" step="0.01" min="0" value="0">
        </div>
        <div class="setup-field">
          <label class="setup-label">Tax ($)</label>
          <input id="charge-tax" class="setup-input" type="number" step="0.01" min="0" value="0">
        </div>
      </div>
      <div class="setup-row">
        <div class="setup-field">
          <label class="setup-label">Gratuity ($)</label>
          <input id="charge-gratuity" class="setup-input" type="number" step="0.01" min="0" value="0">
        </div>
        <div class="setup-field">
          <label class="setup-label">Total ($)</label>
          <input id="charge-total" class="setup-input" type="number" step="0.01" min="0" placeholder="Auto-calculated" readonly>
        </div>
      </div>
    </div>

    <div class="section-label">GUESTS</div>
    <div class="setup-card">
      <div class="setup-field">
        <label class="setup-label">Names (one per line or comma-separated)</label>
        <textarea id="guest-names" class="setup-input setup-textarea" rows="4"
          placeholder="Caleb&#10;Tyler&#10;Jared&#10;Cooper"></textarea>
      </div>
    </div>

    <div style="padding: 20px 20px 40px;">
      <button class="btn btn-green" id="create-btn" onclick="createTab()">Create Tab →</button>
    </div>
  </div>
  <script src="/js/setup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/js/setup.js**

```js
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let items = [];

function recalcTotal() {
  const subtotal = items.reduce((s, item) => s + item.price * item.qty, 0);
  const surcharge = parseFloat(document.getElementById('charge-surcharge').value) || 0;
  const tax       = parseFloat(document.getElementById('charge-tax').value) || 0;
  const gratuity  = parseFloat(document.getElementById('charge-gratuity').value) || 0;
  document.getElementById('charge-total').value =
    (Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100).toFixed(2);
}

function renderItems() {
  const el = document.getElementById('item-editor');
  if (items.length === 0) {
    el.innerHTML = '<div class="item-empty">No items yet — scan a receipt or add manually.</div>';
    recalcTotal();
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="setup-item">
      <input class="setup-item-name" value="${esc(item.name)}"
        placeholder="Item name" onchange="updateItem(${i},'name',this.value)">
      <input class="setup-item-qty" type="number" value="${item.qty}" min="1"
        onchange="updateItem(${i},'qty',+this.value)">
      <span class="setup-item-x">×</span>
      <input class="setup-item-price" type="number" value="${item.price.toFixed(2)}"
        step="0.01" min="0" onchange="updateItem(${i},'price',+this.value)">
      <button class="btn-remove" onclick="removeItem(${i})">✕</button>
    </div>
  `).join('');
  recalcTotal();
}

window.updateItem = (i, field, val) => { items[i][field] = val; recalcTotal(); };
window.removeItem = (i) => { items.splice(i, 1); renderItems(); };
window.addItem    = () => { items.push({ name: '', price: 0.00, qty: 1 }); renderItems(); };

['charge-surcharge', 'charge-tax', 'charge-gratuity'].forEach(id => {
  document.getElementById(id).addEventListener('input', recalcTotal);
});

document.getElementById('receipt-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('parse-status');
  status.textContent = 'Scanning receipt…';
  status.className = 'parse-status';
  const form = new FormData();
  form.append('image', file);
  try {
    const res  = await fetch('/api/receipt/parse', { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    items = data.items.map(i => ({ name: i.name, price: Number(i.price), qty: Number(i.qty) }));
    renderItems();
    status.textContent = `✓ Found ${items.length} item type${items.length === 1 ? '' : 's'} — edit below if needed`;
    status.className = 'parse-status success';
  } catch (err) {
    status.textContent = `Scan failed: ${err.message}. Add items manually below.`;
    status.className = 'parse-status error';
  }
});

window.createTab = async () => {
  const name            = document.getElementById('tab-name').value.trim();
  const paymentHandle   = document.getElementById('payment-handle').value.trim();
  const paymentPlatform = document.getElementById('payment-platform').value.trim() || 'Venmo';
  const surcharge = parseFloat(document.getElementById('charge-surcharge').value) || 0;
  const tax       = parseFloat(document.getElementById('charge-tax').value) || 0;
  const gratuity  = parseFloat(document.getElementById('charge-gratuity').value) || 0;
  const guestText = document.getElementById('guest-names').value;
  const guests    = guestText.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

  if (!name)             return alert('Please enter a tab name.');
  if (items.length === 0) return alert('Please add at least one item.');
  if (guests.length === 0) return alert('Please add at least one guest name.');

  const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const total    = Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100;
  const charges  = { subtotal, surcharge, tax, gratuity, total };

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res  = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    window.location.href = `/host/${data.tabId}`;
  } catch (err) {
    alert(`Failed to create tab: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Create Tab →';
  }
};

renderItems();
```

- [ ] **Step 3: Add setup page styles to public/css/app.css**

Append to the end of `public/css/app.css`:

```css
/* Setup page */
.setup-card {
  background: var(--surface); border: 1px solid var(--border);
  margin: 0 12px 12px; border-radius: 10px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.setup-row { display: flex; gap: 12px; }
.setup-row .setup-field { flex: 1; }
.setup-field { display: flex; flex-direction: column; gap: 4px; }
.setup-label { font-size: 11px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: .06em; }
.setup-input {
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 14px; padding: 8px 10px; width: 100%;
}
.setup-input:focus { outline: none; border-color: var(--accent); }
.setup-textarea { resize: vertical; min-height: 80px; font-family: inherit; }
.upload-btn {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  background: var(--blue-bg); border: 1px solid var(--blue-border); color: var(--blue);
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  transition: opacity .15s;
}
.upload-btn:hover { opacity: .8; }
.parse-status { font-size: 12px; color: var(--muted); min-height: 16px; }
.parse-status.success { color: var(--green); }
.parse-status.error { color: #f87171; }
.item-empty { padding: 12px 20px; color: #555; font-size: 13px; }
.setup-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 20px; border-bottom: 1px solid #1a1a27;
}
.setup-item-name  { flex: 1; min-width: 0; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text); font-size: 13px; padding: 4px 2px; }
.setup-item-qty   { width: 48px; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text); font-size: 13px; padding: 4px 2px; text-align: center; }
.setup-item-price { width: 64px; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--accent); font-size: 13px; padding: 4px 2px; text-align: right; }
.setup-item-name:focus, .setup-item-qty:focus, .setup-item-price:focus { outline: none; border-bottom-color: var(--accent); }
.setup-item-x { color: #555; font-size: 12px; }
.btn-remove {
  background: none; border: none; color: #555; cursor: pointer;
  font-size: 14px; padding: 4px 6px; border-radius: 4px; transition: color .1s;
}
.btn-remove:hover { color: #f87171; }
```

- [ ] **Step 4: Smoke-test the setup page loads**

```bash
node server.js &
sleep 1
curl -s http://localhost:3000/ | grep -c "TabSplitter"
kill %1
```

Expected: `1` (page contains "TabSplitter")

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/setup.js public/css/app.css
git commit -m "feat: add setup page with receipt upload, item editor, and tab creation form"
```

---

## Task 4: Update Host and Guest Pages for tabId

**Files:**
- Modify: `public/host.html`
- Modify: `public/js/host.js`
- Modify: `public/tab.html`
- Modify: `public/js/tab.js`

- [ ] **Step 1: Update public/host.html**

Replace the contents of `public/host.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TabSplitter — Host</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div class="wide">
    <div class="header" style="position:relative;border-radius:10px;margin-bottom:20px;">
      <h1 id="tab-name">Loading…</h1>
      <div class="meta">Host View</div>
    </div>

    <div class="share-box">
      <div style="flex:1;">
        <div class="label">GUEST LINK — SHARE THIS</div>
        <div class="share-url" id="guest-url"></div>
        <button class="btn btn-outline" onclick="copyLink()">Copy Link</button>
      </div>
    </div>

    <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>

    <div class="section-label">GUEST STATUS</div>
    <div class="guest-status-list" id="guest-list"></div>
  </div>

  <div class="settlement-overlay" id="settlement-overlay">
    <h1>🎉</h1>
    <h2>All Settled!</h2>
    <p>Everyone has paid. Enjoy your night.</p>
  </div>

  <script src="/js/host.js"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite public/js/host.js**

```js
const tabId = window.location.pathname.split('/').pop();

function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(tab) {
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('guest-url').textContent = `${window.location.origin}/tab/${tabId}`;

  const paidCount = tab.guests.filter(g => g.paid).length;
  document.getElementById('progress-fill').style.width =
    (tab.guests.length > 0 ? (paidCount / tab.guests.length) * 100 : 0) + '%';

  document.getElementById('guest-list').innerHTML = tab.guests.map(g => `
    <div class="guest-status-row ${g.paid ? 'paid' : ''}">
      <span class="guest-name">${esc(g.name)}</span>
      <span class="guest-owed">${fmt(g.owed)}</span>
      <span class="guest-badge ${g.paid ? 'badge-paid' : 'badge-pending'}">
        ${g.paid ? 'Paid ✓' : 'Pending'}
      </span>
    </div>
  `).join('');

  if (tab.status === 'settled') {
    document.getElementById('settlement-overlay').classList.add('visible');
  }
}

window.copyLink = function () {
  const btn = document.querySelector('.btn-outline');
  navigator.clipboard.writeText(`${window.location.origin}/tab/${tabId}`)
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    })
    .catch(() => prompt('Copy this link:', `${window.location.origin}/tab/${tabId}`));
};

function poll() {
  fetch(`/api/tabs/${tabId}`)
    .then(r => r.json())
    .then(data => { if (!data.error) render(data); });
}
poll();
setInterval(poll, 2000);
```

- [ ] **Step 3: Update public/tab.html**

Replace the contents of `public/tab.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TabSplitter</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <div class="app">
    <div class="header">
      <h1 id="tab-name">Loading…</h1>
      <div class="meta" id="tab-meta"></div>
    </div>

    <div class="payment-banner">
      <div>
        <div class="label">SEND PAYMENT TO</div>
        <div class="payment-handle" id="payment-handle"></div>
      </div>
      <div class="pm-badge" id="payment-platform"></div>
    </div>

    <div class="name-bar">
      <span class="label">You are:</span>
      <div class="name-chips" id="name-chips"></div>
    </div>

    <div class="section-label" id="items-label">ITEMS</div>
    <div id="item-list"></div>

    <div class="section-label">CHARGES</div>
    <div class="charges-section" id="charges-section"></div>
  </div>

  <div class="footer" id="footer" style="display:none">
    <div class="totals">
      <div class="total-row"><span>Your items</span><span id="footer-subtotal"></span></div>
      <div class="total-row"><span>Fees &amp; tip</span><span id="footer-fees"></span></div>
      <div class="total-row grand"><span>You owe</span><span class="amount" id="footer-owed"></span></div>
    </div>
    <button class="btn btn-green" id="settle-btn">✓ I've Settled My Tab</button>
  </div>

  <div class="settlement-overlay" id="settlement-overlay">
    <h1>🎉</h1>
    <h2>All Settled!</h2>
    <p>Everyone has paid. Enjoy your night.</p>
  </div>

  <script src="/js/tab.js"></script>
</body>
</html>
```

- [ ] **Step 4: Rewrite public/js/tab.js**

```js
const tabId = window.location.pathname.split('/').pop();
let tab = null;
let myGuestId = null;

function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.name)) groups.set(item.name, { name: item.name, price: item.price, items: [] });
    groups.get(item.name).items.push(item);
  }
  return [...groups.values()];
}

function render(tabData) {
  tab = tabData;
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('tab-meta').textContent =
    `${tab.guests.length} guests · ${fmt(tab.charges.total)} total`;
  document.getElementById('payment-handle').textContent  = tab.payment.handle;
  document.getElementById('payment-platform').textContent = tab.payment.platform;

  document.getElementById('name-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === myGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="selectGuest('${esc(g.id)}')">
      ${esc(g.name)}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe    = myGuestId !== null && item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls     = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : (!myGuestId ? 'no-guest' : '');
      const check   = (isMe || isTaken) ? '✓' : '';
      const sub     = isMe ? 'Claimed by you' : (claimer ? esc(claimer.name) : '');
      const onclick = isTaken ? '' : myGuestId
        ? `onclick="toggle('${item.id}')"`
        : `onclick="promptName()"`;
      return `<div class="item ${cls}" ${onclick} data-id="${item.id}">
        <div class="item-check">${check}</div>
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          ${sub ? `<div class="item-claimer">${sub}</div>` : ''}
        </div>
        <div class="item-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
    return `<div class="group-header">${esc(group.name)} — ${fmt(group.price)} ea</div>${rows}`;
  }).join('');

  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  if (myGuestId) {
    const me = tab.guests.find(g => g.id === myGuestId);
    if (me) {
      document.getElementById('footer').style.display = 'block';
      document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
      document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
      document.getElementById('footer-owed').textContent = fmt(me.owed);
      const btn = document.getElementById('settle-btn');
      btn.disabled = me.paid;
      btn.textContent = me.paid ? '✓ Paid' : '✓  I\'ve Settled My Tab';
    }
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.selectGuest = function (guestId) {
  myGuestId = guestId;
  if (tab) render(tab);
};

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

window.promptName = function () { showToast('Select your name above first'); };

window.toggle = function (itemId) {
  if (!myGuestId || !tab) return;
  const item = tab.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.claimedBy && item.claimedBy !== myGuestId) return;
  const endpoint = item.claimedBy === myGuestId
    ? `/api/tabs/${tabId}/unclaim`
    : `/api/tabs/${tabId}/claim`;
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, guestId: myGuestId }),
  }).then(r => r.json()).then(data => { if (!data.error) render(data); });
};

document.getElementById('settle-btn').addEventListener('click', () => {
  if (!myGuestId) return;
  fetch(`/api/tabs/${tabId}/paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: myGuestId }),
  }).then(r => r.json()).then(data => {
    if (data.tab) render(data.tab);
    if (data.settled) showSettled();
  });
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) { myGuestId = null; if (tab) render(tab); }
});

function poll() {
  fetch(`/api/tabs/${tabId}`)
    .then(r => r.json())
    .then(data => { if (!data.error) render(data); });
}
poll();
setInterval(poll, 2000);
```

- [ ] **Step 5: Run unit tests to confirm they still pass**

```bash
npm test
```

Expected: All tests in `tests/db.test.js` pass, no failures.

- [ ] **Step 6: Manual smoke test — create a tab and visit guest page**

```bash
node server.js &
sleep 1
# Create a tab
curl -s -X POST http://localhost:3000/api/tabs \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","paymentHandle":"@test","paymentPlatform":"Venmo","charges":{"subtotal":10,"surcharge":0,"tax":0.80,"gratuity":2,"total":12.80},"guests":["Alice","Bob"],"items":[{"name":"Beer","price":5,"qty":2}]}' \
  | grep tabId
kill %1
```

Expected: `{"tabId":"<6chars>"}` — copy the tabId and open `http://localhost:3000/tab/<tabId>` in browser to verify the guest page loads with items.

- [ ] **Step 7: Commit**

```bash
git add public/host.html public/js/host.js public/tab.html public/js/tab.js
git commit -m "feat: update host and guest pages to use tabId URL params"
```

---

## Task 5: Playwright E2E Tests

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/flow.spec.js`

- [ ] **Step 1: Install Playwright browsers**

```bash
npx playwright install chromium
```

Expected: Chromium browser downloaded.

- [ ] **Step 2: Create playwright.config.js**

```js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: { baseURL: 'http://localhost:3001' },
  webServer: {
    command: 'node server.js',
    port: 3001,
    env: {
      PORT: '3001',
      DB_PATH: ':memory:',
      ANTHROPIC_API_KEY: 'test-key',
    },
    reuseExistingServer: false,
  },
});
```

- [ ] **Step 3: Create tests/e2e/flow.spec.js**

```js
const { test, expect } = require('@playwright/test');

async function createTab(page, { guests = ['Alice', 'Bob'], items = [{ name: 'Beer', price: '5.00', qty: '2' }] } = {}) {
  await page.goto('/');
  await page.fill('#tab-name', 'E2E Test Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#charge-tax', '0.80');
  await page.fill('#charge-gratuity', '2.00');
  await page.fill('#guest-names', guests.join('\n'));

  // Add items manually
  for (const item of items) {
    await page.click('button:has-text("+ Add Item")');
    const rows = page.locator('.setup-item');
    const last = rows.last();
    await last.locator('.setup-item-name').fill(item.name);
    await last.locator('.setup-item-qty').fill(String(item.qty));
    await last.locator('.setup-item-price').fill(String(item.price));
  }

  await page.click('#create-btn');
  await page.waitForURL(/\/host\//);
  const tabId = page.url().split('/').pop();
  return tabId;
}

test('setup page creates tab and redirects to host page', async ({ page }) => {
  const tabId = await createTab(page);
  expect(tabId).toHaveLength(6);
  await expect(page.locator('#tab-name')).toHaveText('E2E Test Tab');
  await expect(page.locator('#guest-url')).toContainText(`/tab/${tabId}`);
});

test('guest page shows items and allows claiming', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // Items should be visible but dimmed (no name selected)
  await expect(page.locator('.item').first()).toBeVisible();
  await expect(page.locator('.chip').first()).toBeVisible();

  // Select Alice
  await page.locator('.chip', { hasText: 'Alice' }).click();

  // Claim first item
  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);
});

test('claimed items persist after page refresh', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  await page.locator('.chip', { hasText: 'Alice' }).click();
  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);

  // Reload the page
  await page.reload();

  // Item should still be claimed (shown as claimed-other since no name re-selected)
  await expect(page.locator('.item').first()).toHaveClass(/claimed-other/);

  // Re-select Alice and confirm it's hers
  await page.locator('.chip', { hasText: 'Alice' }).click();
  await expect(page.locator('.item').first()).toHaveClass(/claimed-mine/);
});

test('host page updates when guest pays', async ({ page, context }) => {
  const tabId = await createTab(page, { guests: ['Alice'] });
  const hostPage = page;

  // Open guest page in new tab
  const guestPage = await context.newPage();
  await guestPage.goto(`/tab/${tabId}`);
  await guestPage.locator('.chip', { hasText: 'Alice' }).click();
  await guestPage.locator('#settle-btn').click();

  // Host page should show Alice as paid within 3 seconds
  await hostPage.waitForTimeout(3000);
  await hostPage.reload();
  await expect(hostPage.locator('.guest-status-row')).toHaveClass(/paid/);
});

test('no items appear selected before name is chosen', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // All items should have no-guest class (dimmed)
  const items = page.locator('.item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    await expect(items.nth(i)).toHaveClass(/no-guest/);
  }
});
```

- [ ] **Step 4: Run E2E tests**

```bash
npm run test:e2e
```

Expected: All 5 tests pass. If the "host page updates when guest pays" test is flaky due to timing, increase the `waitForTimeout` to 4000.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.js tests/e2e/flow.spec.js
git commit -m "test: add Playwright E2E tests for tab create, claim, refresh persistence, and settlement"
```

---

## Task 6: Railway Deployment

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Sign up for Railway and create a project**

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select `calebholland17/tab_splitter`
4. Railway auto-detects Node.js. Set **Start Command** to `node server.js`
5. Under **Variables**, add:
   - `ANTHROPIC_API_KEY` = your Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
   - `NODE_ENV` = `production`
6. Click **Deploy**. Railway will build and start the app.
7. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

- [ ] **Step 2: Update .github/workflows/deploy.yml for Railway**

Replace the contents of `.github/workflows/deploy.yml` with:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy
        run: railway up --service tab-splitter
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

- [ ] **Step 3: Add RAILWAY_TOKEN to GitHub secrets**

1. In Railway dashboard: **Account Settings → Tokens → Create Token**
2. Copy the token
3. In GitHub repo: **Settings → Secrets → Actions → New repository secret**
   - Name: `RAILWAY_TOKEN`
   - Value: paste the Railway token

- [ ] **Step 4: Push to trigger deploy**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: update GitHub Actions to deploy to Railway"
git push origin main
```

Expected: GitHub Actions workflow runs, Railway deploys the latest code. Visit your Railway URL to confirm the setup page loads.

- [ ] **Step 5: Verify the live deployment**

Open `https://<your-railway-url>/` in browser.
Expected: Setup page loads with "TabSplitter — Create a new tab".

Create a test tab, copy the guest link, open it in an incognito window, claim an item, refresh — item should still be claimed.

---

## Self-Review

**Spec coverage check:**
- ✅ Setup page: receipt upload → AI parse → editable items → tab create
- ✅ Unique link per tab: `/tab/:tabId`
- ✅ SQLite persistence: `db.js` with `better-sqlite3`
- ✅ Claude Haiku vision for parsing
- ✅ Manual fallback: items start empty if no photo uploaded
- ✅ Host monitor at `/host/:tabId`
- ✅ Guest page at `/tab/:tabId`
- ✅ 2-second polling preserved
- ✅ Railway deployment with persistent process
- ✅ Playwright E2E tests covering refresh persistence
- ✅ Jest unit tests for db.js using `:memory:` SQLite
- ✅ `tabStore.js` deleted, `tests/tabStore.test.js` deleted

**Type consistency:**
- `claimItem(tabId, itemId, guestId)` — consistent across db.js, server.js, tests
- `getTabView(tabId)` — consistent, returns `{ id, name, status, payment, charges, items, guests }`
- `items[].claimedBy` — camelCase in db.js output matches frontend expectation

**No placeholders found.**
