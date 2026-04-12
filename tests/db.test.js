const { buildDb, makeStore } = require('../db');

const SAMPLE_TAB = {
  name: 'Test Tab',
  paymentHandle: '@test',
  paymentPlatform: 'Venmo',
  charges: { subtotal: 20.00, surcharge: 0, tax: 1.60, gratuity: 4.00, total: 25.60 },
  guests: ['Alice', 'Bob'],
  items: [
    { name: 'Beer', price: 5.00, qty: 2 },
    { name: 'Wings', price: 10.00, qty: 1 },
  ],
};

let store;

beforeEach(() => {
  store = makeStore(buildDb(':memory:'));
});

describe('createTab', () => {
  it('returns a 6-char tab id', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    expect(typeof tabId).toBe('string');
    expect(tabId).toHaveLength(6);
  });

  it('expands qty into individual items', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(view.items).toHaveLength(3);
  });

  it('creates the correct number of guests', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(view.guests).toHaveLength(2);
    expect(view.guests.map(g => g.name)).toEqual(['Alice', 'Bob']);
  });
});

describe('getTabView', () => {
  it('returns null for unknown tabId', () => {
    expect(store.getTabView('nope00')).toBeNull();
  });

  it('returns correct shape', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(view.id).toBe(tabId);
    expect(view.name).toBe('Test Tab');
    expect(view.status).toBe('open');
    expect(view.payment).toEqual({ handle: '@test', platform: 'Venmo' });
    expect(view.charges.total).toBe(25.60);
  });

  it('returns subtotal and owed as 0 for guests with no claims', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    for (const g of view.guests) {
      expect(g.subtotal).toBe(0);
      expect(g.owed).toBe(0);
    }
  });

  it('calculates owed proportionally', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const alice = view.guests[0];
    const beer = view.items.find(i => i.name === 'Beer');
    store.claimItem(tabId, beer.id, alice.id);
    const view2 = store.getTabView(tabId);
    const aliceView = view2.guests.find(g => g.name === 'Alice');
    // subtotal=5, total=25.60, multiplier=25.60/20=1.28, owed=5*1.28=6.40
    expect(aliceView.subtotal).toBe(5.00);
    expect(aliceView.owed).toBeCloseTo(6.40, 2);
  });
});

describe('claimItem', () => {
  it('assigns an unclaimed item to a guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    const guest = view.guests[0];
    expect(store.claimItem(tabId, item.id, guest.id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.items.find(i => i.id === item.id).claimedBy).toBe(guest.id);
  });

  it('rejects claiming an already-claimed item', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    store.claimItem(tabId, item.id, view.guests[0].id);
    expect(store.claimItem(tabId, item.id, view.guests[1].id)).toBe(false);
  });

  it('rejects guest from a different tab', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const tabId2 = store.createTab(SAMPLE_TAB);
    const view1 = store.getTabView(tabId);
    const view2 = store.getTabView(tabId2);
    expect(store.claimItem(tabId, view1.items[0].id, view2.guests[0].id)).toBe(false);
  });
});

describe('unclaimItem', () => {
  it('removes a claim by the same guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    const guest = view.guests[0];
    store.claimItem(tabId, item.id, guest.id);
    expect(store.unclaimItem(tabId, item.id, guest.id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.items.find(i => i.id === item.id).claimedBy).toBeNull();
  });

  it('rejects unclaim by a different guest', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    const item = view.items[0];
    store.claimItem(tabId, item.id, view.guests[0].id);
    expect(store.unclaimItem(tabId, item.id, view.guests[1].id)).toBe(false);
  });
});

describe('markPaid and isSettled', () => {
  it('marks a guest paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    expect(store.markPaid(tabId, view.guests[0].id)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.guests[0].paid).toBe(true);
  });

  it('is idempotent on double-pay', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    store.markPaid(tabId, view.guests[0].id);
    expect(store.markPaid(tabId, view.guests[0].id)).toBe(false);
  });

  it('is not settled until all guests paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    store.markPaid(tabId, view.guests[0].id);
    expect(store.isSettled(tabId)).toBe(false);
  });

  it('is settled when all guests paid', () => {
    const tabId = store.createTab(SAMPLE_TAB);
    const view = store.getTabView(tabId);
    for (const g of view.guests) store.markPaid(tabId, g.id);
    expect(store.isSettled(tabId)).toBe(true);
    const view2 = store.getTabView(tabId);
    expect(view2.status).toBe('settled');
  });
});
