# Group Split Toggle Design

**Date:** 2026-06-08
**Status:** Approved

## Overview

Add a per-item `×`/`÷` toggle to the setup form that lets the host enter a total price for shared items instead of manually dividing it. When toggled to `÷` mode, the host enters the full cost of the item and the number of people splitting it — the form shows the per-person price live and sends the divided value to the server at creation time.

## Problem

When an item is shared among a subset of guests (e.g., 5 people splitting a $30 appetizer), the host must manually calculate the per-person price ($6) and enter it with the correct qty (5). For tables with multiple shared items this is tedious and error-prone.

## Solution

A toggle button between the qty and price fields switches each item row between two modes:

**Normal mode** (`×`, default — existing behavior):
```
[name] [qty] × [price per person] [✕]
```

**Split mode** (`÷`):
```
[name] [qty] ÷ [total price] = $X.XX each [✕]
```

In split mode the price field accepts the total cost. A derived `= $X.XX each` label updates live as the host types. qty = number of people splitting the item.

## Data Flow

`splitMode` is frontend-only state. No backend, API, or database changes.

Each item in the `items` array gains a `splitMode: boolean` property (default `false`). Before sending to the server, `createTab` converts split-mode items:

```js
items.map(item => ({
  name: item.name,
  qty: item.qty,
  price: item.splitMode ? item.price / item.qty : item.price
}))
```

The server receives identical data to today — per-unit price and qty. All guest-side behavior is untouched.

`splitMode` is included in the `localStorage` draft so refreshing the page preserves which items are in split mode.

## Edge Cases

- **Toggle back to `×`**: price field value is kept as-is; host adjusts manually if needed
- **qty = 1 in split mode**: total / 1 = total — works correctly, just not useful
- **Receipt scanner output**: always produces `×` mode items (scanner already returns per-unit prices)
- **Price = 0 in split mode**: `= $0.00 each` label shown, no division-by-zero risk since price/qty both default safe
- **qty = 0 in split mode**: `= $0.00 each` label shown (treat as 0); the server receives price=0 which is safe

## Files Changed

| File | Change |
|---|---|
| `public/js/setup.js` | Add `splitMode` to item state; update `renderItems`, `addItem`, `createTab`, `saveState`, `loadState` |
| `public/css/app.css` | Style the `×`/`÷` toggle button — small, muted, tappable on mobile |

**No changes to:** `server.js`, `db.js`, `tab.js`, `host.js`, or any HTML files.
