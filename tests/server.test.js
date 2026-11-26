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
