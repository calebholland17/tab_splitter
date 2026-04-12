# TabSplitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a simple Node.js/Express + Socket.io web app with the Kirkwood Tab 4/11/2026 receipt hardcoded in memory. Guests open a shared link, select their name, claim items in real-time, and see what they owe. Deploy to Azure Web App via the tip_splitter GitHub repo.

**Architecture:** Single Express server with Socket.io. One tab hardcoded at startup in `tabStore.js` — no database, no AI parsing, no setup page. Static HTML/CSS/JS served from `public/`. The frontend uses vanilla JS + Socket.io client for real-time updates.

**Tech Stack:** Node.js 20, Express 4, Socket.io 4, dotenv, Jest, supertest

---

## Hardcoded Tab Data

**Tab:** Kirkwood Tab 4/11/2026  
**Payment:** @Caleb-Holland-3 on Venmo  
**Guests:** Caleb, Tyler, Jared, Cooper, Matt, Josh, Nate, Eli  
**Charges:** Subtotal $315.00 · Surcharge $9.45 · Tax $34.69 · Gratuity $63.00 · **Total $422.34**  
**Multiplier:** 422.34 / 315.00 = 1.34073...

**Items (38 individual):**
- 12 × Coors Light Can @ $6.50
- 8 × Michelob Ultra Draft @ $6.50
- 2 × Chicken Tenders @ $15.00
- 2 × Buffalo Chicken Wrap @ $15.00
- 2 × Pueblo Viejo Blanco Tall @ $10.00
- 6 × Miller Lite Draft @ $6.50
- 1 × Chicken Caesar Wrap @ $14.00
- 1 × BBQ Chicken Quesadillas @ $14.00
- 1 × Blue Moon Draft @ $8.50
- 1 × Pretzel @ $9.00
- 1 × Guinness Stout Draft @ $8.50
- 1 × Confusion, Pueblo Viejo @ $12.00

---

## File Map

| File | Responsibility |
|------|---------------|
| `server.js` | Express + Socket.io entry point, all routes and events |
| `tabStore.js` | Hardcoded tab, all mutations, proportional calculation |
| `public/tab.html` | Guest claiming page |
| `public/host.html` | Host monitor page (shareable link, guest status) |
| `public/css/app.css` | Shared dark theme styles |
| `public/js/tab.js` | Guest page logic + Socket.io client |
| `public/js/host.js` | Host monitor logic + Socket.io client |
| `tests/tabStore.test.js` | Unit tests for tab store logic |

---

## Tasks

### Task 1: Project Scaffolding + Tab Store

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server.js`
- Create: `tabStore.js`
- Create: `tests/tabStore.test.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "tab-splitter",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "jest --forceExit"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.env
*.log
.superpowers/
```

- [ ] **Step 3: Create tabStore.js**

```js
const { randomBytes } = require('crypto');

function id() { return randomBytes(4).toString('hex'); }

// --- Hardcoded Kirkwood Tab ---
function buildKirkwoodTab() {
  const guests = [
    'Caleb', 'Tyler', 'Jared', 'Cooper', 'Matt', 'Josh', 'Nate', 'Eli'
  ].map(name => ({ id: id(), name, paid: false }));

  const rawItems = [
    { name: 'Coors Light Can',          price: 6.50,  qty: 12 },
    { name: 'Michelob Ultra Draft',     price: 6.50,  qty: 8  },
    { name: 'Chicken Tenders',          price: 15.00, qty: 2  },
    { name: 'Buffalo Chicken Wrap',     price: 15.00, qty: 2  },
    { name: 'Pueblo Viejo Blanco Tall', price: 10.00, qty: 2  },
    { name: 'Miller Lite Draft',        price: 6.50,  qty: 6  },
    { name: 'Chicken Caesar Wrap',      price: 14.00, qty: 1  },
    { name: 'BBQ Chicken Quesadillas',  price: 14.00, qty: 1  },
    { name: 'Blue Moon Draft',          price: 8.50,  qty: 1  },
    { name: 'Pretzel',                  price: 9.00,  qty: 1  },
    { name: 'Guinness Stout Draft',     price: 8.50,  qty: 1  },
    { name: 'Confusion, Pueblo Viejo',  price: 12.00, qty: 1  },
  ];

  const items = [];
  for (const { name, price, qty } of rawItems) {
    for (let i = 0; i < qty; i++) {
      items.push({ id: id(), name, price, claimedBy: null });
    }
  }

  return {
    id: 'kirkwood',
    name: 'Kirkwood Tab 4/11/2026',
    status: 'open',
    payment: { handle: '@Caleb-Holland-3', platform: 'Venmo' },
    charges: { subtotal: 315.00, surcharge: 9.45, tax: 34.69, gratuity: 63.00, total: 422.34 },
    guests,
    items,
  };
}

const tab = buildKirkwoodTab();

// --- Calculations ---
function calculateOwed(guestId) {
  const { subtotal, total } = tab.charges;
  const multiplier = subtotal > 0 ? total / subtotal : 0;
  const guestSubtotal = tab.items
    .filter(i => i.claimedBy === guestId)
    .reduce((s, i) => s + i.price, 0);
  return Math.round(guestSubtotal * multiplier * 100) / 100;
}

function isSettled() {
  return tab.guests.length > 0 && tab.guests.every(g => g.paid);
}

function getTabView() {
  return {
    id: tab.id,
    name: tab.name,
    status: tab.status,
    payment: tab.payment,
    charges: tab.charges,
    items: tab.items,
    guests: tab.guests.map(g => {
      const guestSubtotal = tab.items
        .filter(i => i.claimedBy === g.id)
        .reduce((s, i) => s + i.price, 0);
      return {
        ...g,
        subtotal: Math.round(guestSubtotal * 100) / 100,
        owed: calculateOwed(g.id),
      };
    }),
  };
}

// --- Mutations ---
function claimItem(itemId, guestId) {
  const item = tab.items.find(i => i.id === itemId);
  if (!item || item.claimedBy !== null) return false;
  const guest = tab.guests.find(g => g.id === guestId);
  if (!guest) return false;
  item.claimedBy = guestId;
  return true;
}

function unclaimItem(itemId, guestId) {
  const item = tab.items.find(i => i.id === itemId);
  if (!item || item.claimedBy !== guestId) return false;
  item.claimedBy = null;
  return true;
}

function markPaid(guestId) {
  const guest = tab.guests.find(g => g.id === guestId);
  if (!guest) return false;
  guest.paid = true;
  if (isSettled()) tab.status = 'settled';
  return true;
}

function getTab() { return tab; }

module.exports = { getTab, getTabView, claimItem, unclaimItem, markPaid, isSettled, calculateOwed };
```

- [ ] **Step 4: Create tests/tabStore.test.js**

```js
const store = require('../tabStore');

describe('getTab', () => {
  it('returns the kirkwood tab', () => {
    const tab = store.getTab();
    expect(tab.id).toBe('kirkwood');
    expect(tab.name).toBe('Kirkwood Tab 4/11/2026');
    expect(tab.items).toHaveLength(38);
    expect(tab.guests).toHaveLength(8);
  });

  it('has correct total charges', () => {
    const { charges } = store.getTab();
    expect(charges.total).toBe(422.34);
    expect(charges.subtotal).toBe(315.00);
  });
});

describe('claimItem', () => {
  it('assigns an unclaimed item to a guest', () => {
    const tab = store.getTab();
    const item = tab.items[0];
    const guest = tab.guests[0];
    const result = store.claimItem(item.id, guest.id);
    expect(result).toBe(true);
    expect(item.claimedBy).toBe(guest.id);
  });

  it('rejects claiming an already-claimed item', () => {
    const tab = store.getTab();
    // item[0] was claimed in previous test — try a fresh one
    const item = tab.items[1];
    const guest0 = tab.guests[0];
    const guest1 = tab.guests[1];
    store.claimItem(item.id, guest0.id);
    const result = store.claimItem(item.id, guest1.id);
    expect(result).toBe(false);
    expect(item.claimedBy).toBe(guest0.id);
  });
});

describe('unclaimItem', () => {
  it('removes a claim made by the same guest', () => {
    const tab = store.getTab();
    const item = tab.items[2];
    const guest = tab.guests[0];
    store.claimItem(item.id, guest.id);
    const result = store.unclaimItem(item.id, guest.id);
    expect(result).toBe(true);
    expect(item.claimedBy).toBeNull();
  });

  it('rejects unclaiming an item owned by another guest', () => {
    const tab = store.getTab();
    const item = tab.items[3];
    const guest0 = tab.guests[0];
    const guest1 = tab.guests[1];
    store.claimItem(item.id, guest0.id);
    const result = store.unclaimItem(item.id, guest1.id);
    expect(result).toBe(false);
  });
});

describe('calculateOwed', () => {
  it('returns proportional share including tax, tip, fees', () => {
    const tab = store.getTab();
    // Find a guest with no items yet (use last guest for safety)
    const guest = tab.guests[7];
    // Claim one item ($6.50 Coors Light)
    const item = tab.items.find(i => i.name === 'Coors Light Can' && i.claimedBy === null);
    store.claimItem(item.id, guest.id);
    const owed = store.calculateOwed(guest.id);
    // 6.50 * (422.34 / 315.00) = 8.715...
    expect(owed).toBeCloseTo(8.72, 1);
  });
});

describe('markPaid and isSettled', () => {
  it('marks a guest paid', () => {
    const tab = store.getTab();
    const guest = tab.guests[0];
    store.markPaid(guest.id);
    expect(guest.paid).toBe(true);
  });

  it('tab is not settled until all guests paid', () => {
    expect(store.isSettled()).toBe(false);
  });
});

describe('getTabView', () => {
  it('includes subtotal and owed for each guest', () => {
    const view = store.getTabView();
    expect(view.guests).toHaveLength(8);
    for (const g of view.guests) {
      expect(typeof g.subtotal).toBe('number');
      expect(typeof g.owed).toBe('number');
    }
  });
});
```

- [ ] **Step 5: Install dependencies and run tests**

```bash
npm install
npx jest tests/tabStore.test.js --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Create server.js**

```js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getTab, getTabView, claimItem, unclaimItem, markPaid, isSettled } = require('./tabStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab', (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));

// REST: get tab state
app.get('/api/tab', (req, res) => res.json(getTabView()));

// Socket.io
io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('tab_updated', getTabView());

  socket.on('claim_item', ({ itemId, guestId }) => {
    if (claimItem(itemId, guestId)) {
      io.emit('tab_updated', getTabView());
    }
  });

  socket.on('unclaim_item', ({ itemId, guestId }) => {
    if (unclaimItem(itemId, guestId)) {
      io.emit('tab_updated', getTabView());
    }
  });

  socket.on('mark_paid', ({ guestId }) => {
    if (markPaid(guestId)) {
      io.emit('tab_updated', getTabView());
      if (isSettled()) io.emit('tab_settled');
    }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = { app, server };
```

- [ ] **Step 7: Verify server starts**

```bash
node server.js
```

Expected: `TabSplitter running on http://localhost:3000`

Ctrl+C to stop.

- [ ] **Step 8: Commit**

```bash
git init
git add package.json package-lock.json .gitignore server.js tabStore.js tests/tabStore.test.js
git commit -m "feat: server, tab store, and hardcoded Kirkwood receipt"
```

---

### Task 2: CSS

**Files:**
- Create: `public/css/app.css`

- [ ] **Step 1: Create public/css/app.css**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0f0f13;
  --surface: #1a1a27;
  --surface2: #0d0d11;
  --border: #2a2a3d;
  --text: #e4e4ef;
  --muted: #666;
  --accent: #c9b8ff;
  --green: #4ade80;
  --green-bg: #111d11;
  --blue: #7b9fff;
  --blue-bg: #3d5afe22;
  --blue-border: #3d5afe88;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  min-height: 100vh;
  font-size: 14px;
}

.app { max-width: 480px; margin: 0 auto; padding-bottom: 160px; }
.wide { max-width: 560px; margin: 0 auto; padding: 24px 20px; }

/* Header */
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 16px 20px;
  position: sticky; top: 0; z-index: 100;
}
.header h1 { font-size: 18px; font-weight: 700; color: var(--accent); }
.header .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }

/* Payment banner */
.payment-banner {
  background: linear-gradient(135deg, #1a1f3a 0%, #1e2a1e 100%);
  border-bottom: 1px solid var(--border);
  padding: 14px 20px;
  display: flex; align-items: center; justify-content: space-between;
}
.payment-banner .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .07em; }
.payment-handle { font-size: 20px; font-weight: 800; color: var(--accent); }
.pm-badge {
  background: var(--blue-bg); border: 1px solid var(--blue-border);
  color: var(--blue); font-size: 11px; font-weight: 700;
  padding: 3px 10px; border-radius: 9999px;
}

/* Name picker */
.name-bar {
  background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 10px 20px; display: flex; align-items: center; gap: 10px; overflow-x: auto;
}
.name-bar .label { font-size: 12px; color: #888; white-space: nowrap; }
.name-chips { display: flex; gap: 6px; }
.chip {
  padding: 5px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;
  cursor: pointer; border: 1.5px solid #333; color: #aaa; background: transparent;
  white-space: nowrap; transition: all .15s; user-select: none;
}
.chip.active { background: var(--accent); color: #0f0f13; border-color: var(--accent); }
.chip.paid { border-color: var(--green); color: var(--green); }

/* Section label */
.section-label {
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: #555; padding: 14px 20px 6px;
}

/* Group header */
.group-header {
  font-size: 11px; font-weight: 700; color: #444; text-transform: uppercase;
  letter-spacing: .06em; padding: 10px 20px 4px;
  background: var(--surface2); border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border); margin-top: 4px;
}

/* Item rows */
.item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid #1a1a27;
  cursor: pointer; transition: background .1s;
}
.item:hover:not(.claimed-other) { background: var(--surface); }
.item.claimed-mine { background: var(--green-bg); border-left: 3px solid var(--green); padding-left: 17px; }
.item.claimed-mine .item-name { color: var(--green); }
.item.claimed-other { opacity: .45; cursor: default; }
.item.claimed-other .item-name { text-decoration: line-through; color: #555; }
.item-check {
  width: 20px; height: 20px; border-radius: 50%; border: 2px solid #333;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 11px;
}
.item.claimed-mine .item-check { background: var(--green); border-color: var(--green); color: #0f0f13; }
.item.claimed-other .item-check { background: #2a2a3a; border-color: #2a2a3a; color: #555; }
.item-info { flex: 1; min-width: 0; }
.item-name { font-size: 13px; font-weight: 500; }
.item-claimer { font-size: 11px; color: var(--muted); margin-top: 1px; }
.item-price { font-size: 13px; font-weight: 600; color: var(--accent); white-space: nowrap; }
.item.claimed-other .item-price { color: #444; }

/* Charges */
.charges-section { padding: 12px 20px; display: flex; flex-direction: column; gap: 5px; }
.charge-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); }
.charge-row.total { color: var(--text); font-weight: 700; border-top: 1px solid var(--border); padding-top: 6px; margin-top: 2px; }

/* Sticky footer */
.footer {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 12px 20px 20px; max-width: 480px; margin: 0 auto;
}
.totals { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.total-row { display: flex; justify-content: space-between; font-size: 12px; color: #888; }
.total-row.grand { color: var(--text); font-weight: 700; font-size: 15px; margin-top: 4px; }
.total-row.grand .amount { color: var(--green); font-size: 18px; }

/* Buttons */
.btn {
  width: 100%; padding: 13px; border: none; border-radius: 10px;
  font-size: 15px; font-weight: 700; cursor: pointer; transition: opacity .15s;
}
.btn:disabled { opacity: .4; cursor: default; }
.btn-green { background: var(--green); color: #0f0f13; }
.btn-outline {
  background: transparent; border: 1.5px solid var(--border);
  color: var(--text); padding: 8px; font-size: 13px;
  width: auto; border-radius: 6px;
}

/* Settlement overlay */
.settlement-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,.92); z-index: 999;
  align-items: center; justify-content: center;
  flex-direction: column; text-align: center; padding: 40px;
}
.settlement-overlay.visible { display: flex; }
.settlement-overlay h1 { font-size: 56px; margin-bottom: 12px; }
.settlement-overlay h2 { font-size: 28px; margin-bottom: 8px; }
.settlement-overlay p { font-size: 16px; color: var(--muted); }

/* Host monitor */
.share-box {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; margin-bottom: 20px;
  display: flex; gap: 20px; align-items: center;
}
.share-url { word-break: break-all; font-size: 13px; color: var(--accent); margin-bottom: 10px; }
.progress-bar { height: 4px; background: var(--border); border-radius: 2px; margin-bottom: 20px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--green); border-radius: 2px; transition: width .5s; }
.guest-status-list { display: flex; flex-direction: column; gap: 8px; }
.guest-status-row {
  display: flex; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 16px;
}
.guest-status-row.paid { border-color: var(--green); }
.guest-name { flex: 1; font-weight: 600; }
.guest-owed { font-size: 13px; color: var(--accent); }
.guest-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; }
.badge-pending { background: #2a2a3a; color: var(--muted); }
.badge-paid { background: #1a2e1a; color: var(--green); border: 1px solid var(--green); }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/app.css
git commit -m "feat: add shared dark theme CSS"
```

---

### Task 3: Guest Tab Page

**Files:**
- Create: `public/tab.html`
- Create: `public/js/tab.js`

- [ ] **Step 1: Create public/tab.html**

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
    <h1 id="tab-name">TabSplitter</h1>
    <div class="meta" id="tab-meta"></div>
  </div>

  <div class="payment-banner">
    <div>
      <div class="label">Send payment to</div>
      <div class="payment-handle" id="payment-handle">—</div>
    </div>
    <span class="pm-badge" id="payment-platform">Venmo</span>
  </div>

  <div class="name-bar">
    <span class="label">You are:</span>
    <div class="name-chips" id="name-chips"></div>
  </div>

  <div id="item-list"></div>

  <div class="section-label">Charges</div>
  <div class="charges-section" id="charges-section"></div>
</div>

<div class="footer" id="footer" style="display:none;">
  <div class="totals">
    <div class="total-row">
      <span>Your items subtotal</span>
      <span id="footer-subtotal">$0.00</span>
    </div>
    <div class="total-row">
      <span>Your share of tax, tip &amp; fees</span>
      <span id="footer-fees">+ $0.00</span>
    </div>
    <div class="total-row grand">
      <span>You owe</span>
      <span class="amount" id="footer-owed">$0.00</span>
    </div>
  </div>
  <button class="btn btn-green" id="settle-btn">✓ &nbsp;I've Settled My Tab</button>
</div>

<div class="settlement-overlay" id="settlement-overlay">
  <h1>🎉</h1>
  <h2>We're Settled!</h2>
  <p>Everyone has paid. Enjoy your night!</p>
</div>

<script src="/socket.io/socket.io.js"></script>
<script src="/js/tab.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/js/tab.js**

```js
const socket = io();
let tab = null;
let myGuestId = null;

function fmt(n) { return '$' + Number(n).toFixed(2); }

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
  document.getElementById('payment-handle').textContent = tab.payment.handle;
  document.getElementById('payment-platform').textContent = tab.payment.platform;

  // Name chips
  document.getElementById('name-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === myGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="selectGuest('${g.id}')">
      ${g.name}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  // Items grouped
  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe = item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : '';
      const check = (isMe || isTaken) ? '✓' : '';
      const sub = isMe ? 'Claimed by you' : (claimer ? claimer.name : '');
      const onclick = (!isTaken && myGuestId) ? `onclick="toggle('${item.id}')"` : '';
      return `<div class="item ${cls}" ${onclick} data-id="${item.id}">
        <div class="item-check">${check}</div>
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          ${sub ? `<div class="item-claimer">${sub}</div>` : ''}
        </div>
        <div class="item-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
    return `<div class="group-header">${group.name} — ${fmt(group.price)} ea</div>${rows}`;
  }).join('');

  // Charges
  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity (20%)</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  // Footer
  if (myGuestId) {
    const me = tab.guests.find(g => g.id === myGuestId);
    document.getElementById('footer').style.display = 'block';
    document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
    document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
    document.getElementById('footer-owed').textContent = fmt(me.owed);
    const btn = document.getElementById('settle-btn');
    btn.disabled = me.paid;
    btn.textContent = me.paid ? '✓ Paid' : '✓  I\'ve Settled My Tab';
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.selectGuest = function(guestId) {
  myGuestId = guestId;
  render(tab);
};

window.toggle = function(itemId) {
  if (!myGuestId || !tab) return;
  const item = tab.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.claimedBy === myGuestId) {
    socket.emit('unclaim_item', { itemId, guestId: myGuestId });
  } else if (!item.claimedBy) {
    socket.emit('claim_item', { itemId, guestId: myGuestId });
  }
};

document.getElementById('settle-btn').addEventListener('click', () => {
  if (myGuestId) socket.emit('mark_paid', { guestId: myGuestId });
});

socket.on('tab_updated', render);
socket.on('tab_settled', showSettled);
```

- [ ] **Step 3: Start server and test locally**

```bash
node server.js
```

Open `http://localhost:3000/tab` in two browser windows.  
- Window 1: select "Tyler", tap a few beers → they turn green  
- Window 2: select "Caleb", confirm Tyler's items are dimmed in real-time  
- Mark one guest paid → chip shows checkmark  

- [ ] **Step 4: Commit**

```bash
git add public/tab.html public/js/tab.js
git commit -m "feat: add guest tab page with real-time claiming"
```

---

### Task 4: Host Monitor Page

**Files:**
- Create: `public/host.html`
- Create: `public/js/host.js`

- [ ] **Step 1: Create public/host.html**

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
  <div style="padding: 20px 0 16px;">
    <h1 style="color:var(--accent);font-size:22px;">TabSplitter</h1>
    <div id="tab-name" style="font-size:16px;font-weight:600;margin-top:4px;"></div>
  </div>

  <div class="share-box">
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Guest Link — share this</div>
      <div class="share-url" id="guest-url"></div>
      <button class="btn btn-outline" onclick="copyLink()">Copy Link</button>
    </div>
  </div>

  <div class="progress-bar">
    <div class="progress-fill" id="progress-fill" style="width:0%"></div>
  </div>

  <div class="section-label">Guest Status</div>
  <div class="guest-status-list" id="guest-list"></div>
</div>

<div class="settlement-overlay" id="settlement-overlay">
  <h1>🎉</h1>
  <h2>We're Settled!</h2>
  <p>Everyone has paid. Enjoy your night!</p>
</div>

<script src="/socket.io/socket.io.js"></script>
<script src="/js/host.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/js/host.js**

```js
const socket = io();

function fmt(n) { return '$' + Number(n).toFixed(2); }

function render(tab) {
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('guest-url').textContent = `${window.location.origin}/tab`;

  const paidCount = tab.guests.filter(g => g.paid).length;
  document.getElementById('progress-fill').style.width =
    (tab.guests.length > 0 ? (paidCount / tab.guests.length) * 100 : 0) + '%';

  document.getElementById('guest-list').innerHTML = tab.guests.map(g => `
    <div class="guest-status-row ${g.paid ? 'paid' : ''}">
      <span class="guest-name">${g.name}</span>
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

window.copyLink = function() {
  navigator.clipboard.writeText(`${window.location.origin}/tab`)
    .then(() => alert('Link copied!'));
};

socket.on('tab_updated', render);
socket.on('tab_settled', () => document.getElementById('settlement-overlay').classList.add('visible'));
```

- [ ] **Step 3: Full end-to-end local test**

```bash
node server.js
```

1. Open `http://localhost:3000` (host view) — see guest list at $0 owed each, copy the guest link  
2. Open `http://localhost:3000/tab` in a separate window — select a name, claim items  
3. Host view updates in real-time showing updated `owed` amounts  
4. Mark all 8 guests paid → "We're Settled! 🎉" on both screens  

- [ ] **Step 4: Commit**

```bash
git add public/host.html public/js/host.js
git commit -m "feat: add host monitor page with live guest status"
```

---

### Task 5: Deploy to GitHub + Azure

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Push to tip_splitter on GitHub**

```bash
gh repo view tip_splitter --json sshUrl -q .sshUrl
# If repo doesn't exist: gh repo create tip_splitter --public
git remote add origin $(gh repo view tip_splitter --json sshUrl -q .sshUrl)
git branch -M main
git push -u origin main
```

- [ ] **Step 2: Create Azure Web App**

```bash
az login
az group create --name tabsplitter-rg --location eastus
az appservice plan create --name tabsplitter-plan --resource-group tabsplitter-rg --sku B1 --is-linux
az webapp create --name tabsplitter-app --resource-group tabsplitter-rg \
  --plan tabsplitter-plan --runtime "NODE:20-lts"
az webapp config set --name tabsplitter-app --resource-group tabsplitter-rg \
  --web-sockets-enabled true
az webapp config appsettings set --name tabsplitter-app --resource-group tabsplitter-rg \
  --settings WEBSITE_NODE_DEFAULT_VERSION="~20"
```

- [ ] **Step 3: Set up GitHub Actions deployment**

In Azure Portal → tabsplitter-app → Overview → **Download publish profile** → save the file.

```bash
gh secret set AZURE_WEBAPP_PUBLISH_PROFILE < ~/Downloads/tabsplitter-app.PublishSettings
gh secret set AZURE_WEBAPP_NAME --body "tabsplitter-app"
```

- [ ] **Step 4: Create .github/workflows/deploy.yml**

```yaml
name: Deploy to Azure Web App

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --omit=dev

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v3
        with:
          app-name: ${{ secrets.AZURE_WEBAPP_NAME }}
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .
```

- [ ] **Step 5: Push and watch deploy**

```bash
mkdir -p .github/workflows
git add .github/workflows/deploy.yml
git commit -m "ci: deploy to Azure Web App on push to main"
git push origin main
gh run watch
```

Expected: Workflow completes. App live at `https://tabsplitter-app.azurewebsites.net`.

- [ ] **Step 6: Verify live app**

```bash
az webapp show --name tabsplitter-app --resource-group tabsplitter-rg \
  --query defaultHostName -o tsv
```

Open the URL — full app should work identically to local. Send `/tab` URL to the group.

---

## Verification

- [ ] `npx jest --no-coverage` — all tests pass
- [ ] Two browser windows on `/tab` → real-time claim updates work
- [ ] All 8 guests mark paid → "We're Settled! 🎉" on all screens
- [ ] Math: each guest's owed sums to $422.34 across all 8
- [ ] Azure: `https://tabsplitter-app.azurewebsites.net/tab` loads and WebSockets work
