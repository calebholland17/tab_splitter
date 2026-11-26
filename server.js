if (!['production', 'test'].includes(process.env.NODE_ENV)) require('dotenv').config();
const express = require('express');
const path    = require('path');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const {
  createTab, getTabView, claimItem, unclaimItem, markPaid, isSettled,
} = require('./db');
const { createHash, timingSafeEqual } = require('crypto');
// Module object (not destructured) so new event/stats calls can be spied on in tests.
const store = require('./db');
const { startOfUtcDay } = require('./stats');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Usage events
// IPv6 clients usually control a whole /64, so group them by that prefix;
// otherwise rotating addresses would sidestep the per-IP scan limit.
function clientKey(ip) {
  if (!ip.includes(':') || /^::ffff:\d/i.test(ip)) return ip;
  const addr = ip.toLowerCase().split('%')[0];
  const [head, tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = addr.includes('::') && tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

function ipHashOf(req) {
  const key = clientKey(req.get('Fly-Client-IP') || req.ip || 'unknown');
  return createHash('sha256').update((process.env.IP_SALT || 'dev-salt') + key).digest('hex').slice(0, 16);
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

// Scans still waiting on the API have no event row yet, so they're counted here.
// Memory is fine for this: in-flight work only exists while the machine is up.
const inFlight = { total: 0, byIp: new Map() };

function reserveScan(ipHash) {
  inFlight.total++;
  inFlight.byIp.set(ipHash, (inFlight.byIp.get(ipHash) || 0) + 1);
}

function releaseScan(ipHash) {
  inFlight.total--;
  const n = inFlight.byIp.get(ipHash) - 1;
  if (n > 0) inFlight.byIp.set(ipHash, n); else inFlight.byIp.delete(ipHash);
}

function scanBlockReason(ipHash, now = Date.now()) {
  if (process.env.SCANS_DISABLED === '1') return 'disabled';
  const { perHour, perDay } = scanLimits();
  const pendingIp = inFlight.byIp.get(ipHash) || 0;
  try {
    const hourAgo = now - HOUR;
    if (store.countEvents('receipt_scan', { since: hourAgo, ipHash, okOnly: true }) + pendingIp >= perHour) return 'ip_hour';
    // Failed scans are still billed; a looser cap on all attempts stops a script feeding junk.
    if (store.countEvents('receipt_scan', { since: hourAgo, ipHash }) + pendingIp >= 3 * perHour) return 'ip_hour';
    if (store.countEvents('receipt_scan', { since: startOfUtcDay(now), okOnly: true }) + inFlight.total >= perDay) return 'daily_cap';
  } catch (err) {
    console.error('[limits] check failed, allowing scan:', err.message);
  }
  return null;
}

// Pages
app.get('/',            (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/host/:tabId', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab/:tabId',  (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));
app.get('/admin',       (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// Receipt parsing
app.post('/api/receipt/parse', (req, res, next) => {
  const ipHash = ipHashOf(req);
  const reason = scanBlockReason(ipHash);
  if (!reason) {
    // Check and reserve happen in one synchronous step, so parallel requests can't all slip through.
    reserveScan(ipHash);
    res.once('close', () => releaseScan(ipHash));
    return next();
  }
  track('scan_blocked', req, { meta: { reason } });
  res.status(429).json({ error: SCAN_BLOCKED_MESSAGES[reason] });
}, async (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    let usage = null;
    try {
      const response = await anthropic.messages.create({
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
              text: 'Extract all data from this receipt. Return ONLY a JSON object with no markdown: {"items": [{"name": string, "price": number, "qty": number}], "charges": {"surcharge": number, "tax": number, "gratuity": number}, "total": number}. Rules for items: (1) price is always the per-item unit price, never the line total. (2) If both a unit price and line total appear (e.g. "12 @ $6.50 $78.00"), use the unit price. (3) If a quantity greater than 1 appears on a line with only ONE dollar amount and no "@" or per-unit marker, that dollar amount is the line total for all of them combined, not the unit price — divide it by the quantity to get the unit price. For example "6 Sam Adams $30" means unit price 30/6 = 5.00, and "4 Miller Lite  $24.00" means unit price 24/4 = 6.00, NOT $24.00 each. Before finalizing each item, check: does price × qty roughly equal the dollar amount printed on that line? If not, you used the wrong number — fix it. (4) If no quantity is shown, use qty=1. (5) Do not include subtotals, taxes, tips, gratuity, or totals in the items array. Rules for charges: surcharge is any mandatory service charge or fee (not tax or tip); tax is sales tax; gratuity is any tip or auto-gratuity. Use 0 for any charge not present. Rules for total: use the grand total shown on the receipt.',
            },
          ],
        }],
      });
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
  });
});

// Create tab
app.post('/api/tabs', (req, res) => {
  const { name, paymentHandle, paymentPlatform, charges, guests, items } = req.body || {};
  try {
    const tabId = createTab({ name, paymentHandle, paymentPlatform, charges, guests, items });
    track('tab_created', req, { tabId, meta: { scanned: req.body.scanned === true } });
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
    const ok = claimItem(req.params.tabId, itemId, guestId);
    if (!ok) return res.status(409).json({ error: 'Item already claimed or invalid request' });
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Unclaim item
app.post('/api/tabs/:tabId/unclaim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    const ok = unclaimItem(req.params.tabId, itemId, guestId);
    if (!ok) return res.status(409).json({ error: 'Item not claimed by this guest' });
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark paid
app.post('/api/tabs/:tabId/paid', (req, res) => {
  const { guestId } = req.body || {};
  try {
    if (markPaid(req.params.tabId, guestId)) {
      track('guest_paid', req, { tabId: req.params.tabId, meta: { guestId } });
    }
    res.json({ tab: getTabView(req.params.tabId), settled: isSettled(req.params.tabId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = app;
