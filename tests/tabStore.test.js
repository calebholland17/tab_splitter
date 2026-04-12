const store = require('../tabStore');

beforeEach(() => store.resetTab());

describe('getTab', () => {
  it('returns the kirkwood tab', () => {
    const tab = store.getTab();
    expect(tab.id).toBe('kirkwood');
    expect(tab.name).toBe('Kirkwood Tab 4/11/2026');
    expect(tab.items).toHaveLength(38);
    expect(tab.guests).toHaveLength(8);
  });

  it('has correct total charges', () => {
    const { charges } = store.getTab();
    expect(charges.total).toBe(422.34);
    expect(charges.subtotal).toBe(315.00);
  });
});

describe('claimItem', () => {
  it('assigns an unclaimed item to a guest', () => {
    const tab = store.getTab();
    const item = tab.items[0];
    const guest = tab.guests[0];
    expect(store.claimItem(item.id, guest.id)).toBe(true);
    expect(item.claimedBy).toBe(guest.id);
  });

  it('rejects claiming an already-claimed item', () => {
    const tab = store.getTab();
    const item = tab.items[0];
    store.claimItem(item.id, tab.guests[0].id);
    expect(store.claimItem(item.id, tab.guests[1].id)).toBe(false);
    expect(item.claimedBy).toBe(tab.guests[0].id);
  });
});

describe('unclaimItem', () => {
  it('removes a claim made by the same guest', () => {
    const tab = store.getTab();
    const item = tab.items[0];
    const guest = tab.guests[0];
    store.claimItem(item.id, guest.id);
    expect(store.unclaimItem(item.id, guest.id)).toBe(true);
    expect(item.claimedBy).toBeNull();
  });

  it('rejects unclaiming an item owned by another guest', () => {
    const tab = store.getTab();
    const item = tab.items[0];
    store.claimItem(item.id, tab.guests[0].id);
    expect(store.unclaimItem(item.id, tab.guests[1].id)).toBe(false);
  });
});

describe('calculateOwed', () => {
  it('returns proportional share including tax, tip, fees', () => {
    const tab = store.getTab();
    const guest = tab.guests[0];
    store.claimItem(tab.items[0].id, guest.id); // $6.50 Coors Light
    const owed = store.calculateOwed(guest.id);
    // 6.50 * (422.34 / 315.00) = 8.715... rounds to 8.72
    expect(owed).toBeCloseTo(8.71, 1);
  });

  it('returns 0 for guest with no items', () => {
    const tab = store.getTab();
    expect(store.calculateOwed(tab.guests[0].id)).toBe(0);
  });
});

describe('markPaid and isSettled', () => {
  it('marks a guest paid', () => {
    const tab = store.getTab();
    expect(store.markPaid(tab.guests[0].id)).toBe(true);
    expect(tab.guests[0].paid).toBe(true);
  });

  it('rejects double-pay', () => {
    const tab = store.getTab();
    store.markPaid(tab.guests[0].id);
    expect(store.markPaid(tab.guests[0].id)).toBe(false);
  });

  it('is not settled until all guests paid', () => {
    const tab = store.getTab();
    tab.guests.slice(0, 7).forEach(g => store.markPaid(g.id));
    expect(store.isSettled()).toBe(false);
    expect(tab.status).toBe('open');
  });

  it('sets status to settled when all guests paid', () => {
    const tab = store.getTab();
    tab.guests.forEach(g => store.markPaid(g.id));
    expect(store.isSettled()).toBe(true);
    expect(tab.status).toBe('settled');
  });
});

describe('getTabView', () => {
  it('includes subtotal and owed for each guest', () => {
    const view = store.getTabView();
    expect(view.guests).toHaveLength(8);
    for (const g of view.guests) {
      expect(typeof g.subtotal).toBe('number');
      expect(typeof g.owed).toBe('number');
    }
  });

  it('calculates owed proportionally based on claimed items', () => {
    const tab = store.getTab();
    const guest = tab.guests[0];
    store.claimItem(tab.items[0].id, guest.id); // $6.50
    const view = store.getTabView();
    const guestView = view.guests.find(g => g.id === guest.id);
    expect(guestView.subtotal).toBe(6.50);
    expect(guestView.owed).toBeCloseTo(8.71, 1);
  });
});
