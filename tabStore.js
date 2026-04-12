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
  const { subtotal, total } = tab.charges;
  const multiplier = subtotal > 0 ? total / subtotal : 0;
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
      const rounded = Math.round(guestSubtotal * 100) / 100;
      return {
        ...g,
        subtotal: rounded,
        owed: Math.round(guestSubtotal * multiplier * 100) / 100,
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
  if (!guest || guest.paid) return false;
  guest.paid = true;
  if (isSettled()) tab.status = 'settled';
  return true;
}

function getTab() { return tab; }

function resetTab() {
  const fresh = buildKirkwoodTab();
  tab.status = fresh.status;
  tab.guests.splice(0, tab.guests.length, ...fresh.guests);
  tab.items.splice(0, tab.items.length, ...fresh.items);
}

module.exports = { getTab, getTabView, claimItem, unclaimItem, markPaid, isSettled, calculateOwed, resetTab };
