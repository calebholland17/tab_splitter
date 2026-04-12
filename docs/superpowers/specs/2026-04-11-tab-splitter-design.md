# TabSplitter — Design Spec
**Date:** 2026-04-11  
**Status:** Approved

---

## Context

After a group night out, splitting a bar tab fairly is painful. Venmo math is done on phones, people forget what they ordered, and the person who paid gets chased for a week. TabSplitter solves this: the host uploads a photo of the receipt, guests open a shared link on their phones, each person taps the items they ordered, and the app calculates exactly what each person owes — proportionally accounting for tax, tip, and surcharges. Once everyone marks themselves paid, the tab is settled.

---

## Stack

- **Runtime:** Node.js + Express
- **Real-time:** Socket.io (WebSockets)
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Receipt parsing:** Anthropic Claude API (vision)
- **State:** In-memory (tab is a one-session event; no persistence needed)
- **Hosting:** Azure Web App (Node.js)
- **Repo:** GitHub → `tip_splitter`

---

## User Roles

### Host
Creates the tab, edits items, sets guest names and payment handle, shares the link.

### Guest
Opens the shared link, selects their name, taps items to claim, sees what they owe, marks themselves paid.

---

## Flows

### Host Setup Flow
1. Open the app root (`/`) → host setup page
2. Upload receipt photo → Claude vision API parses it
3. Review & edit parsed items (add, remove, rename, change price)
4. Enter guest names (comma-separated or one per line)
5. Enter payment handle (e.g. `@Caleb-Holland-3`) and platform (Venmo / CashApp / Zelle)
6. Click **Start Tab** → app creates a unique tab ID, redirects to `/host/:tabId`
7. Host sees the live view with a shareable guest URL (`/tab/:tabId`) and a QR code
8. Host monitors real-time as guests claim items and pay

### Guest Flow
1. Open `/tab/:tabId` → name picker screen
2. Select name from preset list
3. See item list grouped by drink/food type
4. Tap items to claim (green highlight = mine, dimmed/struck = claimed by someone else)
5. Footer shows running total: items subtotal + proportional share of charges = **you owe $X.XX**
6. Tap **✓ I've Settled My Tab** to mark as paid
7. When all guests are paid → all screens show **"We're Settled! 🎉"**

---

## Receipt Parsing

### Input
Host uploads a photo of the receipt.

### Claude Vision Prompt
Instruct Claude to return structured JSON:
```json
{
  "items": [
    { "name": "Coors Light Can", "unit_price": 6.50, "quantity": 12 },
    { "name": "Michelob Ultra Draft", "unit_price": 6.50, "quantity": 8 },
    ...
  ],
  "subtotal": 315.00,
  "surcharge": 9.45,
  "tax": 34.69,
  "gratuity": 63.00,
  "total": 422.34
}
```

### Expansion
The server expands grouped items into individual claimable rows:
- `Coors Light Can × 12` → 12 separate items, each `$6.50`
- Each item gets a unique `id`, `name`, `price`, `claimedBy: null`

### Host Edit Step
After parsing, host sees an editable table before going live:
- Edit item name or price inline
- Delete a row
- Add a row manually
- Confirm → tab goes live

---

## Proportional Split Formula

```
multiplier = total / subtotal
you_owe    = your_items_subtotal × multiplier
```

Everyone's totals sum exactly to the check total. Tax, surcharge, and gratuity are distributed proportionally — heavier orders pay more of the extras.

---

## Data Model (in-memory)

```js
Tab {
  id: string,           // nanoid, 8 chars
  items: Item[],
  guests: Guest[],
  payment: {
    handle: string,     // e.g. "@Caleb-Holland-3"
    platform: string,   // "Venmo" | "CashApp" | "Zelle"
  },
  charges: {
    subtotal: number,
    surcharge: number,
    tax: number,
    gratuity: number,
    total: number,
  },
  status: "open" | "settled",
  createdAt: Date,
}

Item {
  id: string,
  name: string,
  price: number,
  claimedBy: string | null,  // guest id
}

Guest {
  id: string,
  name: string,
  paid: boolean,
}
```

---

## Real-Time Events (Socket.io)

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join_tab` | client → server | `{ tabId, guestId }` | Guest joins tab room |
| `claim_item` | client → server | `{ tabId, itemId, guestId }` | Guest claims an item |
| `unclaim_item` | client → server | `{ tabId, itemId, guestId }` | Guest unclaims their item |
| `mark_paid` | client → server | `{ tabId, guestId }` | Guest marks themselves paid |
| `tab_updated` | server → all clients | full tab state | Broadcast after any mutation |
| `tab_settled` | server → all clients | `{}` | All guests paid |

All mutations are validated server-side before broadcast.

---

## UI Screens

### `/` — Host Setup
- Receipt image upload
- Parsing spinner → item edit table
- Guest name input
- Payment handle + platform selector
- **Start Tab** button

### `/host/:tabId` — Host Monitor
- Shareable guest link + QR code
- Live item list showing who claimed what
- Guest status list (claimed / paid)
- Overall progress bar

### `/tab/:tabId` — Guest View
- **Header:** app name, date, guest count, total
- **Payment banner:** `@Caleb-Holland-3 · Venmo` (always visible)
- **Name picker:** horizontal scroll chips — tap to select yourself
- **Item list:** grouped by category, each item tappable
  - Green + checkmark = claimed by you
  - Dimmed + strikethrough = claimed by someone else
  - White = unclaimed, available
- **Sticky footer:** your subtotal / your proportional share / **you owe $X.XX** / **✓ I've Settled My Tab** button

### Settlement Screen (overlay)
All screens transition to a full-screen "We're Settled! 🎉" message when every guest is marked paid.

---

## File Structure

```
TabSplitter/
├── server.js               # Express + Socket.io entry point
├── package.json
├── .env.example            # ANTHROPIC_API_KEY
├── public/
│   ├── index.html          # Host setup page
│   ├── host.html           # Host monitor page
│   ├── tab.html            # Guest claiming page
│   ├── css/
│   │   └── app.css
│   └── js/
│       ├── setup.js        # Host setup logic
│       ├── host.js         # Host monitor logic
│       └── tab.js          # Guest claiming logic
└── docs/
    └── superpowers/specs/
        └── 2026-04-11-tab-splitter-design.md
```

---

## Local Development

```bash
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
node server.js         # runs on http://localhost:3000
```

---

## Azure Deployment

- **Service:** Azure Web App (Node.js 20 LTS)
- **Startup command:** `node server.js`
- **Environment variable:** `ANTHROPIC_API_KEY` set in App Settings
- **WebSockets:** must be enabled in Azure Web App config
- Deploy via GitHub Actions on push to `main`

---

## Verification

1. Run locally → upload receipt photo → confirm items are parsed correctly
2. Edit an item → confirm change persists in the live tab
3. Open guest URL in two browser tabs → claim an item in one → confirm it dims in real-time in the other
4. Mark all guests paid → confirm "We're Settled!" appears on all screens
5. Verify math: sum of all guest totals === check total
