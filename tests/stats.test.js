const { buildDb, makeStore } = require('../db');
const { startOfUtcDay, startOfUtcMonth } = require('../stats');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 10, 26, 15, 0, 0); // Thu 26 Nov 2026, 15:00 UTC

let db, store;

beforeEach(() => {
  db = buildDb(':memory:');
  store = makeStore(db);
});

function tabAt(time, { guests = ['A', 'B'], total = 25.6 } = {}) {
  const id = store.createTab({
    name: 'T', paymentHandle: '@h', paymentPlatform: 'Venmo',
    charges: { subtotal: 20, surcharge: 0, tax: 1.6, gratuity: 4, total },
    guests,
    items: [{ name: 'Beer', price: 10, qty: 2 }],
  });
  db.prepare('UPDATE tabs SET created_at = ? WHERE id = ?').run(time, id);
  return id;
}

describe('UTC helpers', () => {
  it('startOfUtcDay returns midnight UTC', () => {
    expect(startOfUtcDay(NOW)).toBe(Date.UTC(2026, 10, 26));
  });
  it('startOfUtcMonth returns the first of the month UTC', () => {
    expect(startOfUtcMonth(NOW)).toBe(Date.UTC(2026, 10, 1));
  });
});

describe('getStats', () => {
  it('returns zeros and nulls (never NaN) for an empty database', () => {
    const s = store.getStats(NOW);
    expect(s.generatedAt).toBe(NOW);
    expect(s.scannedSince).toBeNull();
    expect(s.growth.tabs).toEqual({ last7: 0, prev7: 0, allTime: 0 });
    expect(s.growth.split).toEqual({ last7: 0, prev7: 0, allTime: 0 });
    expect(s.growth.weekly).toHaveLength(12);
    expect(s.growth.weekly.every(w => w.tabs === 0)).toBe(true);
    expect(s.engagement).toEqual({ scanRate: null, avgGuestsPerTab: null, avgItemsPerTab: null, paidRate: null });
    expect(s.cost).toEqual({ scansToday: 0, blockedToday: 0, failRate7d: null, costTodayUsd: 0, costMonthUsd: 0, topIpsToday: [] });
    expect(s.tips).toEqual({ last7: 0, allTime: 0 });
  });

  it('splits growth into last 7 days, previous 7 days, and all time', () => {
    tabAt(NOW - 1 * DAY);
    tabAt(NOW - 2 * DAY, { guests: ['A', 'B', 'C'], total: 10 });
    tabAt(NOW - 8 * DAY);
    tabAt(NOW - 30 * DAY);
    const { growth } = store.getStats(NOW);
    expect(growth.tabs).toEqual({ last7: 2, prev7: 1, allTime: 4 });
    expect(growth.guests).toEqual({ last7: 5, prev7: 2, allTime: 9 });
    expect(growth.split.last7).toBeCloseTo(35.6);
    expect(growth.split.prev7).toBeCloseTo(25.6);
    expect(growth.split.allTime).toBeCloseTo(86.8);
  });

  it('puts a tab created exactly 7 days ago in last7, not prev7', () => {
    tabAt(NOW - WEEK);
    const { growth } = store.getStats(NOW);
    expect(growth.tabs.last7).toBe(1);
    expect(growth.tabs.prev7).toBe(0);
  });

  it('falls back to summing charge parts when total is missing, and treats malformed charges as $0', () => {
    const a = tabAt(NOW - DAY);
    const b = tabAt(NOW - DAY);
    db.prepare('UPDATE tabs SET charges = ? WHERE id = ?').run('{"subtotal":10,"tax":1}', a);
    db.prepare('UPDATE tabs SET charges = ? WHERE id = ?').run('{not json', b);
    expect(store.getStats(NOW).growth.split.last7).toBeCloseTo(11);
  });

  it('buckets tabs into 12 rolling weeks, oldest first', () => {
    tabAt(NOW - DAY);
    tabAt(NOW - 8 * DAY);
    const { weekly } = store.getStats(NOW).growth;
    expect(weekly[0].weekStart).toBe(NOW - 12 * WEEK);
    expect(weekly[11].weekStart).toBe(NOW - WEEK);
    expect(weekly[11].tabs).toBe(1);
    expect(weekly[10].tabs).toBe(1);
  });

  it('computes engagement rates', () => {
    const t1 = tabAt(NOW - DAY);
    tabAt(NOW - DAY, { guests: ['A', 'B', 'C'] });
    const guestId = store.getTabView(t1).guests[0].id;
    store.markPaid(t1, guestId);
    store.logEvent('tab_created', { meta: { scanned: true } }, NOW - 3 * DAY);
    store.logEvent('tab_created', { meta: { scanned: false } }, NOW - 2 * DAY);
    store.logEvent('tab_created', { meta: { scanned: true } }, NOW - DAY);
    const s = store.getStats(NOW);
    expect(s.scannedSince).toBe(NOW - 3 * DAY);
    expect(s.engagement.scanRate).toBeCloseTo(2 / 3);
    expect(s.engagement.avgGuestsPerTab).toBeCloseTo(2.5);
    expect(s.engagement.avgItemsPerTab).toBeCloseTo(2);
    expect(s.engagement.paidRate).toBeCloseTo(0.2);
  });

  it('computes scan cost, fail rate, blocked count, and top IPs', () => {
    const tok = { inTok: 1000, outTok: 200 }; // $0.002 per scan
    store.logEvent('receipt_scan', { ipHash: 'aaa', meta: { ok: true, ...tok } }, NOW - 1 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'aaa', meta: { ok: true, ...tok } }, NOW - 2 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'bbb', meta: { ok: false, ...tok } }, NOW - 3 * HOUR);
    store.logEvent('receipt_scan', { ipHash: 'ccc', meta: { ok: true, ...tok } }, startOfUtcDay(NOW) - HOUR); // yesterday
    store.logEvent('scan_blocked', { ipHash: 'aaa', meta: { reason: 'ip_hour' } }, NOW - HOUR);
    const { cost } = store.getStats(NOW);
    expect(cost.scansToday).toBe(2);
    expect(cost.blockedToday).toBe(1);
    expect(cost.failRate7d).toBeCloseTo(0.25);
    expect(cost.costTodayUsd).toBeCloseTo(0.006);
    expect(cost.costMonthUsd).toBeCloseTo(0.008);
    expect(cost.topIpsToday).toEqual([{ ipHash: 'aaa', scans: 2 }, { ipHash: 'bbb', scans: 1 }]);
  });

  it('counts tip taps', () => {
    store.logEvent('tip_click', { meta: { amount: 1 } }, NOW - DAY);
    store.logEvent('tip_click', { meta: { amount: 2 } }, NOW - 10 * DAY);
    expect(store.getStats(NOW).tips).toEqual({ last7: 1, allTime: 2 });
  });
});
