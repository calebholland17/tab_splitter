const request = require('supertest');

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }))
);

const ENV_KEYS = ['ADMIN_TOKEN', 'IP_SALT', 'TIP_VENMO_HANDLE', 'SCAN_LIMIT_PER_HOUR', 'SCAN_LIMIT_PER_DAY', 'SCANS_DISABLED'];

const SCAN_OK = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      items: [{ name: 'Beer', price: 5, qty: 2 }],
      charges: { surcharge: 0, tax: 1, gratuity: 0 },
      total: 11,
    }),
  }],
  usage: { input_tokens: 1500, output_tokens: 200 },
};

const TAB_BODY = {
  name: 'T', paymentHandle: '@h', paymentPlatform: 'Venmo',
  charges: { subtotal: 10, surcharge: 0, tax: 0, gratuity: 0, total: 10 },
  guests: ['Alice'],
  items: [{ name: 'Beer', price: 10, qty: 1 }],
};

let app, store;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  mockCreate.mockReset();
  mockCreate.mockResolvedValue(SCAN_OK);
  // Fresh server + fresh in-memory DB per test.
  jest.isolateModules(() => {
    app = require('../server');
    store = require('../db');
  });
});

afterEach(() => jest.restoreAllMocks());

function scan(ip = '1.1.1.1') {
  return request(app)
    .post('/api/receipt/parse')
    .set('Fly-Client-IP', ip)
    .attach('image', Buffer.from('fake'), { filename: 'r.jpg', contentType: 'image/jpeg' });
}

describe('event logging', () => {
  it('logs a successful scan with item count, token usage, and a hashed IP', async () => {
    const res = await scan('9.9.9.9');
    expect(res.status).toBe(200);
    const [e] = store.listEvents('receipt_scan');
    expect(e.meta).toEqual({ ok: true, items: 1, inTok: 1500, outTok: 200 });
    expect(e.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(e.ipHash).not.toContain('9.9.9.9');
  });

  it('logs a failed API call as ok:false with zero tokens', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded'));
    const res = await scan();
    expect(res.status).toBe(400);
    const [e] = store.listEvents('receipt_scan');
    expect(e.meta).toMatchObject({ ok: false, inTok: 0, outTok: 0, error: 'overloaded' });
  });

  it('logs real token usage when the model returns unparseable JSON', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 900, output_tokens: 50 } });
    const res = await scan();
    expect(res.status).toBe(400);
    expect(store.listEvents('receipt_scan')[0].meta).toMatchObject({ ok: false, inTok: 900, outTok: 50 });
  });

  it('logs tab_created with the scanned flag', async () => {
    const a = await request(app).post('/api/tabs').send({ ...TAB_BODY, scanned: true });
    const b = await request(app).post('/api/tabs').send(TAB_BODY);
    const events = store.listEvents('tab_created');
    expect(events.find(e => e.tabId === a.body.tabId).meta).toEqual({ scanned: true });
    expect(events.find(e => e.tabId === b.body.tabId).meta).toEqual({ scanned: false });
  });

  it('logs guest_paid exactly once when Mark Paid is tapped twice', async () => {
    const { body: { tabId } } = await request(app).post('/api/tabs').send(TAB_BODY);
    const guestId = store.getTabView(tabId).guests[0].id;
    await request(app).post(`/api/tabs/${tabId}/paid`).send({ guestId });
    await request(app).post(`/api/tabs/${tabId}/paid`).send({ guestId });
    const events = store.listEvents('guest_paid');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tabId, meta: { guestId } });
  });

  it('logging failures never break tab creation', async () => {
    jest.spyOn(store, 'logEvent').mockImplementation(() => { throw new Error('disk full'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/api/tabs').send(TAB_BODY);
    expect(res.status).toBe(200);
    expect(res.body.tabId).toHaveLength(6);
  });

  it('hashes the same IP differently with a different IP_SALT', async () => {
    await scan('5.5.5.5');
    process.env.IP_SALT = 'another-salt';
    await scan('5.5.5.5');
    const [second, first] = store.listEvents('receipt_scan');
    expect(second.ipHash).not.toBe(first.ipHash);
  });
});
describe('scan limits', () => {
  it('blocks the 11th successful scan from one IP within an hour', async () => {
    for (let i = 0; i < 10; i++) expect((await scan('2.2.2.2')).status).toBe(200);
    const res = await scan('2.2.2.2');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("You've scanned a lot of receipts recently — try again in a bit, or enter items manually.");
    expect(mockCreate).toHaveBeenCalledTimes(10);
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'ip_hour' });
  });

  it('does not block a different IP', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '1';
    await scan('3.3.3.3');
    expect((await scan('4.4.4.4')).status).toBe(200);
  });

  it('honors SCAN_LIMIT_PER_HOUR', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    await scan(); await scan();
    expect((await scan()).status).toBe(429);
  });

  it('falls back to the default when SCAN_LIMIT_PER_HOUR is not a positive number', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = 'abc';
    for (let i = 0; i < 10; i++) await scan();
    expect((await scan()).status).toBe(429);
    expect(mockCreate).toHaveBeenCalledTimes(10);
  });

  it('does not count failed scans toward the limit', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    mockCreate.mockRejectedValue(new Error('blurry'));
    for (let i = 0; i < 3; i++) expect((await scan()).status).toBe(400);
    mockCreate.mockResolvedValue(SCAN_OK);
    expect((await scan()).status).toBe(200);
  });

  it('ignores scans older than an hour', async () => {
    process.env.SCAN_LIMIT_PER_HOUR = '2';
    await scan('6.6.6.6');
    const { ipHash } = store.listEvents('receipt_scan')[0];
    for (let i = 0; i < 5; i++) {
      store.logEvent('receipt_scan', { ipHash, meta: { ok: true } }, Date.now() - 61 * 60 * 1000);
    }
    expect((await scan('6.6.6.6')).status).toBe(200);
  });

  it('enforces the global daily cap across IPs', async () => {
    process.env.SCAN_LIMIT_PER_DAY = '2';
    await scan('7.0.0.1'); await scan('7.0.0.2');
    const res = await scan('7.0.0.3');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Receipt scanning is taking a break right now — you can still enter items manually.');
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'daily_cap' });
  });

  it('SCANS_DISABLED=1 blocks every scan without calling the API', async () => {
    process.env.SCANS_DISABLED = '1';
    const res = await scan();
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(store.listEvents('scan_blocked')[0].meta).toEqual({ reason: 'disabled' });
  });
});
describe('admin stats', () => {
  it('returns 404 when ADMIN_TOKEN is not configured', async () => {
    const res = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(404);
  });

  it('returns 401 without a key, with a wrong key, and with a key of a different length', async () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
    expect((await request(app).get('/api/admin/stats').set('Authorization', 'Bearer secret-token-124')).status).toBe(401);
    expect((await request(app).get('/api/admin/stats').set('Authorization', 'Bearer x')).status).toBe(401);
  });

  it('returns stats with the configured scan cap for the right key', async () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    process.env.SCAN_LIMIT_PER_DAY = '250';
    await request(app).post('/api/tabs').send(TAB_BODY);
    const res = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer secret-token-123');
    expect(res.status).toBe(200);
    expect(res.body.growth.tabs.allTime).toBe(1);
    expect(res.body.growth.weekly).toHaveLength(12);
    expect(res.body.cost.scanCap).toBe(250);
  });

  it('serves the dashboard page at /admin', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="growth"');
  });
});
