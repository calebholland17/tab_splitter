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
