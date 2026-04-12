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
