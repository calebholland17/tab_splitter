# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the guest experience with two receipt upload options, a locked identity picker, a Venmo deep-link pay button, and a cleaner paid-chip UI.

**Architecture:** All changes are frontend-only (HTML/CSS/JS). No backend changes required. The identity lock is session-scoped (module-level JS variable) — refreshing resets it intentionally.

**Tech Stack:** Vanilla HTML/CSS/JS, existing Express/SQLite backend unchanged, Playwright for E2E tests.

---

## File Structure

- Modify: `public/index.html` — replace single scan button with two upload options
- Modify: `public/js/setup.js` — shared handler for both file inputs
- Modify: `public/tab.html` — add identity picker section, two-button footer
- Modify: `public/js/tab.js` — identity lock logic, Venmo URL, split render functions
- Modify: `public/css/app.css` — identity picker styles, locked chip, two-button footer, paid chip fix
- Modify: `tests/e2e/flow.spec.js` — update for new confirm step and settle flow

---

## Task 1: Two Upload Options on Setup Page

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/setup.js`
- Modify: `public/css/app.css`

- [ ] **Step 1: Update the RECEIPT section in `public/index.html`**

Replace:
```html
    <div class="section-label">RECEIPT</div>
    <div class="setup-card">
      <label class="upload-btn" for="receipt-upload">
        📷 Scan Receipt with AI
        <input type="file" id="receipt-upload" accept="image/*" capture="environment" style="display:none">
      </label>
      <div id="parse-status" class="parse-status"></div>
    </div>
```

With:
```html
    <div class="section-label">RECEIPT</div>
    <div class="setup-card">
      <div class="upload-btns">
        <label class="upload-btn" for="receipt-camera">
          📷 Scan with Camera
          <input type="file" id="receipt-camera" accept="image/*" capture="environment" style="display:none">
        </label>
        <label class="upload-btn" for="receipt-library">
          🖼 Upload from Library
          <input type="file" id="receipt-library" accept="image/*" style="display:none">
        </label>
      </div>
      <div id="parse-status" class="parse-status"></div>
    </div>
```

- [ ] **Step 2: Update `public/js/setup.js` to use a shared handler**

Replace the existing `receipt-upload` event listener block (lines 51–71):
```js
async function handleReceiptFile(file) {
  if (!file) return;
  const status = document.getElementById('parse-status');
  status.textContent = 'Scanning receipt…';
  status.className = 'parse-status';
  const form = new FormData();
  form.append('image', file);
  try {
    const res  = await fetch('/api/receipt/parse', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    items = data.items.map(i => ({ name: i.name, price: Number(i.price), qty: Number(i.qty) }));
    renderItems();
    status.textContent = `✓ Found ${items.length} item type${items.length === 1 ? '' : 's'} — edit below if needed`;
    status.className = 'parse-status success';
  } catch (err) {
    status.textContent = `Scan failed: ${err.message}. Add items manually below.`;
    status.className = 'parse-status error';
  }
}

['receipt-camera', 'receipt-library'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => handleReceiptFile(e.target.files[0]));
});
```

- [ ] **Step 3: Add `.upload-btns` CSS to `public/css/app.css`**

Append after the existing `.upload-btn:hover` rule (line 205):
```css
.upload-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.upload-btns .upload-btn { flex: 1; justify-content: center; }
```

- [ ] **Step 4: Start the server and manually verify setup page shows two buttons**

```bash
node server.js &
sleep 1
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
kill %1
```

Expected: 200. Open `http://localhost:3000/` in a browser — RECEIPT section should show "📷 Scan with Camera" and "🖼 Upload from Library" side by side.

- [ ] **Step 5: Run unit tests to confirm nothing broke**

```bash
npm test
```

Expected: 16 tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/setup.js public/css/app.css
git commit -m "feat: add camera scan and library upload options to setup page"
```

---

## Task 2: Guest Page — Identity Picker, Lock, Venmo Flow, Paid Chip Fix

**Files:**
- Modify: `public/tab.html`
- Modify: `public/js/tab.js`
- Modify: `public/css/app.css`

- [ ] **Step 1: Replace `public/tab.html` with the new structure**

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

    <!-- Shown before identity is confirmed -->
    <div id="identity-picker">
      <div class="identity-prompt">Who are you?</div>
      <div class="identity-chips" id="identity-chips"></div>
      <div class="identity-confirm-bar">
        <button class="btn btn-green" id="confirm-identity-btn" disabled onclick="confirmIdentity()">This is me →</button>
      </div>
    </div>

    <!-- Shown after identity confirmed; other chips are locked -->
    <div class="name-bar" id="name-bar" style="display:none">
      <span class="label">You are:</span>
      <div class="name-chips" id="name-chips"></div>
    </div>

    <!-- Hidden until identity confirmed -->
    <div id="items-section" style="display:none">
      <div class="section-label">ITEMS</div>
      <div id="item-list"></div>
      <div class="section-label">CHARGES</div>
      <div class="charges-section" id="charges-section"></div>
    </div>
  </div>

  <div class="footer" id="footer" style="display:none">
    <div class="totals">
      <div class="total-row"><span>Your items</span><span id="footer-subtotal"></span></div>
      <div class="total-row"><span>Fees &amp; tip</span><span id="footer-fees"></span></div>
      <div class="total-row grand"><span>You owe</span><span class="amount" id="footer-owed"></span></div>
    </div>
    <div class="footer-actions">
      <a class="btn btn-venmo" id="venmo-btn" href="#">Pay on Venmo →</a>
      <button class="btn btn-green" id="settle-btn">I've Paid ✓</button>
    </div>
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

- [ ] **Step 2: Replace `public/js/tab.js` with the new implementation**

```js
const tabId = window.location.pathname.split('/').filter(Boolean).pop();
let tab = null;
let myGuestId = null;
let identityLocked = false;
let pendingGuestId = null;

function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.name)) groups.set(item.name, { name: item.name, price: item.price, items: [] });
    groups.get(item.name).items.push(item);
  }
  return [...groups.values()];
}

function renderIdentityPicker() {
  document.getElementById('identity-picker').style.display = 'block';
  document.getElementById('name-bar').style.display = 'none';
  document.getElementById('items-section').style.display = 'none';
  document.getElementById('footer').style.display = 'none';

  document.getElementById('identity-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === pendingGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="pickGuest('${esc(g.id)}')">
      ${esc(g.name)}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  document.getElementById('confirm-identity-btn').disabled = !pendingGuestId;
}

function renderMain() {
  document.getElementById('identity-picker').style.display = 'none';
  document.getElementById('name-bar').style.display = 'flex';
  document.getElementById('items-section').style.display = 'block';

  // Name bar: current user chip active, all others locked
  document.getElementById('name-chips').innerHTML = tab.guests.map(g => {
    const isMe = g.id === myGuestId;
    const cls  = isMe ? `active${g.paid ? ' paid' : ''}` : 'locked';
    return `<div class="chip ${cls}">${esc(g.name)}${g.paid ? ' ✓' : ''}</div>`;
  }).join('');

  // Items
  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe    = item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls     = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : '';
      const check   = (isMe || isTaken) ? '✓' : '';
      const sub     = isMe ? 'Claimed by you' : (claimer ? esc(claimer.name) : '');
      const onclick = isTaken ? '' : `onclick="toggle('${item.id}')"`;
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

  // Charges
  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  // Footer
  const me = tab.guests.find(g => g.id === myGuestId);
  if (me) {
    document.getElementById('footer').style.display = 'block';
    document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
    document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
    document.getElementById('footer-owed').textContent = fmt(me.owed);

    const venmoHandle = tab.payment.handle.replace(/^@/, '');
    const venmoUrl = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(venmoHandle)}&amount=${me.owed.toFixed(2)}&note=${encodeURIComponent(tab.name)}`;
    const venmoBtn = document.getElementById('venmo-btn');
    venmoBtn.href = me.paid ? '#' : venmoUrl;
    venmoBtn.textContent = me.paid ? '✓ Paid on Venmo' : `Pay ${fmt(me.owed)} on Venmo →`;
    venmoBtn.classList.toggle('btn-disabled', me.paid);

    const settleBtn = document.getElementById('settle-btn');
    settleBtn.disabled = me.paid;
    settleBtn.textContent = me.paid ? '✓ Settled' : "I've Paid ✓";
  }
}

function render(tabData) {
  tab = tabData;
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('tab-meta').textContent =
    `${tab.guests.length} guests · ${fmt(tab.charges.total)} total`;
  document.getElementById('payment-handle').textContent = tab.payment.handle;
  document.getElementById('payment-platform').textContent = tab.payment.platform;

  if (identityLocked) {
    renderMain();
  } else {
    renderIdentityPicker();
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.pickGuest = function (guestId) {
  pendingGuestId = guestId;
  if (tab) renderIdentityPicker();
};

window.confirmIdentity = function () {
  if (!pendingGuestId) return;
  myGuestId = pendingGuestId;
  identityLocked = true;
  if (tab) renderMain();
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
  })
    .then(r => r.json())
    .then(data => { if (!data.error) render(data); })
    .catch(() => showToast('Something went wrong, please try again'));
};

document.getElementById('settle-btn').addEventListener('click', () => {
  if (!myGuestId) return;
  fetch(`/api/tabs/${tabId}/paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: myGuestId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.tab) render(data.tab);
      if (data.settled) showSettled();
    })
    .catch(() => showToast('Something went wrong, please try again'));
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    myGuestId = null;
    identityLocked = false;
    pendingGuestId = null;
    if (tab) render(tab);
  }
});

let pollInterval = null;

function poll() {
  fetch(`/api/tabs/${tabId}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        clearInterval(pollInterval);
        document.getElementById('tab-name').textContent = 'Tab not found';
      } else {
        render(data);
      }
    })
    .catch(() => {
      clearInterval(pollInterval);
      document.getElementById('tab-name').textContent = 'Connection error — reload to retry';
    });
}
poll();
pollInterval = setInterval(poll, 2000);
```

- [ ] **Step 3: Append new CSS rules to `public/css/app.css`**

Append after the last line (`.create-btn-bar`):
```css

/* Identity picker */
#identity-picker {
  background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 20px;
}
.identity-prompt { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 14px; }
.identity-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.identity-chips .chip { font-size: 13px; padding: 10px 18px; }
.identity-confirm-bar { }

/* Locked chip (name bar after identity confirmed) */
.chip.locked { opacity: 0.3; cursor: default; pointer-events: none; }

/* Active + paid chip: green background (overrides purple active) */
.chip.active.paid { background: var(--green); color: #0f0f13; border-color: var(--green); }

/* Two-button footer */
.footer-actions { display: flex; flex-direction: column; gap: 8px; }
.btn-venmo {
  background: var(--blue-bg); border: 1.5px solid var(--blue-border);
  color: var(--blue); text-decoration: none; text-align: center; display: block;
}
.btn-venmo.btn-disabled { opacity: 0.4; pointer-events: none; }
```

- [ ] **Step 4: Run unit tests**

```bash
npm test
```

Expected: 16 tests pass (backend is unchanged).

- [ ] **Step 5: Smoke test the guest page manually**

```bash
node server.js &
sleep 1
RESULT=$(curl -s -X POST http://localhost:3000/api/tabs \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","paymentHandle":"@Caleb-Holland-3","paymentPlatform":"Venmo","charges":{"subtotal":10,"surcharge":0,"tax":0.80,"gratuity":2,"total":12.80},"guests":["Alice","Bob"],"items":[{"name":"Beer","price":5,"qty":2}]}')
TAB_ID=$(echo "$RESULT" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).tabId)")
echo "Visit: http://localhost:3000/tab/$TAB_ID"
kill %1
```

Open the URL in a browser. Verify:
1. "Who are you?" prompt appears with Alice and Bob chips
2. Tapping a chip enables the "This is me →" button
3. Confirming shows the name bar (locked), items, and footer
4. Footer shows "Pay $X.XX on Venmo →" and "I've Paid ✓" buttons
5. Other name chips cannot be clicked

- [ ] **Step 6: Commit**

```bash
git add public/tab.html public/js/tab.js public/css/app.css
git commit -m "feat: identity picker with lock, Venmo deep link, two-button settle flow"
```

---

## Task 3: Update E2E Tests

**Files:**
- Modify: `tests/e2e/flow.spec.js`

- [ ] **Step 1: Replace `tests/e2e/flow.spec.js` with updated tests**

The key changes:
- All tests that visit `/tab/:tabId` now need to click a chip in `#identity-chips` then click `#confirm-identity-btn` before interacting with items
- Test 5 now checks that `#items-section` is hidden before identity is confirmed (replaces the `.no-guest` class check)

```js
const { test, expect } = require('@playwright/test');

async function createTab(page, { guests = ['Alice', 'Bob'], items = [{ name: 'Beer', price: '5.00', qty: '2' }] } = {}) {
  await page.goto('/');
  await page.fill('#tab-name', 'E2E Test Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#charge-tax', '0.80');
  await page.fill('#charge-gratuity', '2.00');
  await page.fill('#guest-names', guests.join('\n'));

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
  const tabId = page.url().split('/').filter(Boolean).pop();
  return tabId;
}

async function selectGuest(page, name) {
  await page.locator('#identity-chips .chip', { hasText: name }).click();
  await page.locator('#confirm-identity-btn').click();
  await expect(page.locator('#items-section')).toBeVisible();
}

test('setup page creates tab and redirects to host page', async ({ page }) => {
  const tabId = await createTab(page);
  expect(tabId).toHaveLength(6);
  await expect(page.locator('#tab-name')).toHaveText('E2E Test Tab');
  await expect(page.locator('#guest-url')).toContainText(`/tab/${tabId}`);
});

test('guest page shows identity picker then items after confirmation', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // Identity picker should be visible, items hidden
  await expect(page.locator('#identity-picker')).toBeVisible();
  await expect(page.locator('#items-section')).toBeHidden();

  // Confirm button disabled until a name is picked
  await expect(page.locator('#confirm-identity-btn')).toBeDisabled();

  // Select Alice and confirm
  await selectGuest(page, 'Alice');

  // Items now visible, identity picker hidden
  await expect(page.locator('#identity-picker')).toBeHidden();
  await expect(page.locator('.item').first()).toBeVisible();
});

test('guest can claim item and item shows as claimed-mine', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);
  await selectGuest(page, 'Alice');

  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);
});

test('claimed items persist after page refresh', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);
  await selectGuest(page, 'Alice');

  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);

  // Reload — identity resets, item still claimed
  await page.reload();
  await expect(page.locator('#identity-picker')).toBeVisible();
  await expect(page.locator('.item').first()).toBeHidden(); // items hidden until name picked

  // Re-select Alice — item shows as claimed-mine again
  await selectGuest(page, 'Alice');
  await expect(page.locator('.item').first()).toHaveClass(/claimed-mine/);
});

test('host page updates when guest pays', async ({ page, context }) => {
  const tabId = await createTab(page, { guests: ['Alice'] });
  const hostPage = page;

  const guestPage = await context.newPage();
  await guestPage.goto(`/tab/${tabId}`);
  await selectGuest(guestPage, 'Alice');
  await guestPage.locator('#settle-btn').click();

  await expect(hostPage.locator('.guest-status-row', { hasText: 'Alice' })).toHaveClass(/paid/, { timeout: 8000 });
});

test('items section hidden before identity is confirmed', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  await expect(page.locator('#identity-picker')).toBeVisible();
  await expect(page.locator('#items-section')).toBeHidden();
  await expect(page.locator('#footer')).toBeHidden();
});
```

- [ ] **Step 2: Run E2E tests**

```bash
npm run test:e2e
```

Expected: All 6 tests pass. If "host page updates" is slow, the 8-second timeout should cover it.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flow.spec.js
git commit -m "test: update E2E tests for identity picker and new settle flow"
```

---

## Self-Review

**Spec coverage:**
- ✅ Two upload options: camera scan + library upload
- ✅ Identity picker shown on load, locks after confirm
- ✅ Other chips non-clickable after identity confirmed
- ✅ Venmo deep link button with pre-filled handle + amount
- ✅ Separate "I've Paid ✓" button calls the paid API
- ✅ Paid chip UI fix: `active.paid` → green background, no text conflict
- ✅ No items visible until identity confirmed
- ✅ Refresh resets identity lock (pageshow handler updated)
- ✅ E2E tests updated for new flow

**Type consistency:**
- `pickGuest(guestId)` / `confirmIdentity()` / `renderIdentityPicker()` / `renderMain()` — consistent throughout
- `identityLocked`, `pendingGuestId`, `myGuestId` — all reset together in pageshow handler
- `venmoHandle` stripped of `@` consistently in `renderMain()`
