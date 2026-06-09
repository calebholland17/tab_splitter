# Group Split Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-item `×`/`÷` toggle to the setup form so the host can enter a total price for shared items instead of manually dividing it.

**Architecture:** Frontend-only change. Each item in the `items` array gains a `splitMode` boolean. In split mode the price field accepts the total cost; a `= $X.XX each` label shows the derived per-person price live. Before sending to the server, `createTab` converts split-mode items to per-unit prices — the server, DB, and guest page are untouched.

**Tech Stack:** Vanilla JS (`public/js/setup.js`), CSS (`public/css/app.css`), Playwright E2E tests

---

## File Map

| Action | Path | Change |
|---|---|---|
| Modify | `public/css/app.css` | Replace `.setup-item-x` with `.setup-item-operator` button styles; add `.setup-item-each` label style |
| Modify | `public/js/setup.js` | Add `splitMode` to item state; update `renderItems`, `recalcTotal`, `addItem`, `loadState`, `createTab`; add `toggleSplitMode` |
| Modify | `tests/e2e/flow.spec.js` | Add E2E test verifying split mode label and per-person price on guest page |

---

## Task 1: Add CSS for operator button and per-person label

**Files:**
- Modify: `public/css/app.css:239` (`.setup-item-x` line)

The `.setup-item-x` span is being replaced by a `<button class="setup-item-operator">`. Replace that one CSS rule and add the two new rules.

- [ ] **Step 1: Replace `.setup-item-x` and add new styles**

In `public/css/app.css`, replace this line:
```css
.setup-item-x { color: #555; font-size: 12px; }
```

With:
```css
.setup-item-operator {
  background: none; border: none; color: var(--muted); font-size: 12px;
  cursor: pointer; padding: 4px 2px; border-radius: 3px;
  transition: color .1s; font-family: inherit;
}
.setup-item-operator:hover { color: var(--text); }
.setup-item-operator.split { color: var(--accent); font-weight: 600; }
.setup-item-each { color: var(--muted); font-size: 11px; white-space: nowrap; }
```

- [ ] **Step 2: Commit**

```bash
git add public/css/app.css
git commit -m "feat: add CSS for split mode operator button and per-person label"
```

---

## Task 2: Update setup.js — state, rendering, toggle

**Files:**
- Modify: `public/js/setup.js`

Four changes in this task: `addItem` (new item default), `loadState` (normalize persisted items), `renderItems` (operator button + each label), new `toggleSplitMode` function.

- [ ] **Step 1: Update `addItem` to include `splitMode: false`**

Find:
```js
window.addItem    = () => { items.push({ name: '', price: 0, qty: 1 }); renderItems(); saveState(); };
```

Replace with:
```js
window.addItem    = () => { items.push({ name: '', price: 0, qty: 1, splitMode: false }); renderItems(); saveState(); };
```

- [ ] **Step 2: Update `loadState` to normalize `splitMode`**

Find:
```js
    if (Array.isArray(s.items))       items = s.items;
```

Replace with:
```js
    if (Array.isArray(s.items))       items = s.items.map(i => ({ ...i, splitMode: !!i.splitMode }));
```

This ensures items loaded from localStorage before this feature existed default to `splitMode: false`.

- [ ] **Step 3: Update `renderItems` to use operator button and per-person label**

Find the entire `el.innerHTML = items.map(...)` block:
```js
  el.innerHTML = items.map((item, i) => `
    <div class="setup-item">
      <input class="setup-item-name" value="${esc(item.name)}"
        placeholder="Item name" oninput="updateItem(${i},'name',this.value)">
      <input class="setup-item-qty" type="number" value="${item.qty}" min="1"
        oninput="updateItem(${i},'qty',+this.value)">
      <span class="setup-item-x">×</span>
      <input class="setup-item-price" type="number" value="${item.price > 0 ? item.price.toFixed(2) : ''}"
        step="0.01" min="0" inputmode="decimal" placeholder="0.00"
        oninput="updateItem(${i},'price',+this.value)" onfocus="this.select()">
      <button class="btn-remove" onclick="removeItem(${i})">✕</button>
    </div>
  `).join('');
```

Replace with:
```js
  el.innerHTML = items.map((item, i) => {
    const eachLabel = item.splitMode && item.qty > 0
      ? `<span class="setup-item-each">= $${(item.price / item.qty).toFixed(2)} each</span>`
      : '';
    return `
    <div class="setup-item">
      <input class="setup-item-name" value="${esc(item.name)}"
        placeholder="Item name" oninput="updateItem(${i},'name',this.value)">
      <input class="setup-item-qty" type="number" value="${item.qty}" min="1"
        oninput="updateItem(${i},'qty',+this.value)">
      <button class="setup-item-operator${item.splitMode ? ' split' : ''}" onclick="toggleSplitMode(${i})">${item.splitMode ? '÷' : '×'}</button>
      <input class="setup-item-price" type="number" value="${item.price > 0 ? item.price.toFixed(2) : ''}"
        step="0.01" min="0" inputmode="decimal" placeholder="${item.splitMode ? 'Total' : '0.00'}"
        oninput="updateItem(${i},'price',+this.value)" onfocus="this.select()">
      ${eachLabel}
      <button class="btn-remove" onclick="removeItem(${i})">✕</button>
    </div>
  `;
  }).join('');
```

- [ ] **Step 4: Add `toggleSplitMode` function**

Find:
```js
window.updateItem = (i, field, val) => { items[i][field] = val; recalcTotal(); saveState(); };
```

Add the new function on the line immediately after it:
```js
window.toggleSplitMode = (i) => { items[i].splitMode = !items[i].splitMode; renderItems(); saveState(); };
```

- [ ] **Step 5: Commit**

```bash
git add public/js/setup.js
git commit -m "feat: add split mode state, rendering, and toggle to setup form"
```

---

## Task 3: Update setup.js — recalcTotal and createTab

**Files:**
- Modify: `public/js/setup.js`

Two more changes: fix the subtotal calculation in `recalcTotal` and `createTab` to handle split-mode items (where `item.price` is the total, not per-unit).

- [ ] **Step 1: Fix `recalcTotal` to handle split mode**

Find:
```js
  const subtotal = items.reduce((s, item) => s + item.price * item.qty, 0);
```

Replace with:
```js
  const subtotal = items.reduce((s, item) => s + (item.splitMode ? item.price : item.price * item.qty), 0);
```

- [ ] **Step 2: Fix `createTab` — normalize items and fix subtotal**

Find this block inside `window.createTab`:
```js
  const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const total    = Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100;
  const charges  = { subtotal, surcharge, tax, gratuity, total };
```

Replace with:
```js
  const itemsToSend = items.map(({ name, qty, price, splitMode }) => ({
    name,
    qty,
    price: splitMode && qty > 0 ? price / qty : price,
  }));
  const subtotal = Math.round(itemsToSend.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const total    = Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100;
  const charges  = { subtotal, surcharge, tax, gratuity, total };
```

- [ ] **Step 3: Use `itemsToSend` in the fetch body**

Find:
```js
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items }),
```

Replace with:
```js
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items: itemsToSend }),
```

- [ ] **Step 4: Commit**

```bash
git add public/js/setup.js
git commit -m "feat: divide split-mode item price before sending to server"
```

---

## Task 4: Write and run E2E test

**Files:**
- Modify: `tests/e2e/flow.spec.js`

- [ ] **Step 1: Write the failing E2E test**

Add this test at the end of `tests/e2e/flow.spec.js`:

```js
test('split mode shows per-person label and sends divided price to server', async ({ page }) => {
  await page.goto('/');
  await page.fill('#tab-name', 'Split Test');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#guest-names', 'Alice\nBob\nCharlie');

  await page.click('button:has-text("+ Add Item")');
  const row = page.locator('.setup-item').last();
  await row.locator('.setup-item-name').fill('Wine');
  await row.locator('.setup-item-qty').fill('3');
  await row.locator('.setup-item-operator').click();
  await row.locator('.setup-item-price').fill('30.00');

  // Per-person label should show $10.00
  await expect(row.locator('.setup-item-each')).toHaveText('= $10.00 each');

  // Create the tab
  await page.click('#create-btn');
  await page.waitForURL(/\/host\//);
  const tabId = page.url().split('/').filter(Boolean).pop();

  // Guest page should show 3 claimable Wine items at $10.00 each
  await page.goto(`/tab/${tabId}`);
  await page.locator('#identity-chips .chip', { hasText: 'Alice' }).click();
  await page.locator('#confirm-identity-btn').click();
  await expect(page.locator('#items-section')).toBeVisible();

  const wineItems = page.locator('.item', { hasText: 'Wine' });
  await expect(wineItems).toHaveCount(3);
  await expect(wineItems.first().locator('.item-price')).toHaveText('$10.00');
});
```

- [ ] **Step 2: Run E2E tests**

```bash
npm run test:e2e
```

Expected: all 7 tests pass (6 existing + 1 new).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flow.spec.js
git commit -m "test: add E2E test for split mode item price division"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify split mode on setup page**

Open `http://localhost:3000` in a browser. Add an item, click the `×` button — it should change to `÷`. Set qty to `3`, enter price `30.00`. Verify `= $10.00 each` appears. Change qty to `4` — label should update to `= $7.50 each`.

- [ ] **Step 3: Verify toggle back**

Click `÷` again — button returns to `×`, the `= $X.XX each` label disappears.

- [ ] **Step 4: Verify the tab total is correct**

With one split item (total $30, qty 3) and no charges, the total field should read `30.00` (not `90.00`).

- [ ] **Step 5: Verify guest page**

Create the tab. On the guest page, verify there are 3 separate `Wine` rows each showing `$10.00`.

- [ ] **Step 6: Push to deploy**

```bash
git push origin main
```
