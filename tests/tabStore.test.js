const store = require('../tabStore');

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
    const result = store.claimItem(item.id, guest.id);
    expect(result).toBe(true);
    expect(item.claimedBy).toBe(guest.id);
  });

  it('rejects claiming an already-claimed item', () => {
    const tab = store.getTab();
    const item = tab.items[1];
    const guest0 = tab.guests[0];
    const guest1 = tab.guests[1];
    store.claimItem(item.id, guest0.id);
    const result = store.claimItem(item.id, guest1.id);
    expect(result).toBe(false);
    expect(item.claimedBy).toBe(guest0.id);
  });
});

describe('unclaimItem', () => {
  it('removes a claim made by the same guest', () => {
    const tab = store.getTab();
    const item = tab.items[2];
    const guest = tab.guests[0];
    store.claimItem(item.id, guest.id);
    const result = store.unclaimItem(item.id, guest.id);
    expect(result).toBe(true);
    expect(item.claimedBy).toBeNull();
  });

  it('rejects unclaiming an item owned by another guest', () => {
    const tab = store.getTab();
    const item = tab.items[3];
    const guest0 = tab.guests[0];
    const guest1 = tab.guests[1];
    store.claimItem(item.id, guest0.id);
    const result = store.unclaimItem(item.id, guest1.id);
    expect(result).toBe(false);
  });
});

describe('calculateOwed', () => {
  it('returns proportional share including tax, tip, fees', () => {
    const tab = store.getTab();
    const guest = tab.guests[7];
    const item = tab.items.find(i => i.name === 'Coors Light Can' && i.claimedBy === null);
    store.claimItem(item.id, guest.id);
    const owed = store.calculateOwed(guest.id);
    // 6.50 * (422.34 / 315.00) = 8.715...
    expect(owed).toBeCloseTo(8.72, 1);
  });
});

describe('markPaid and isSettled', () => {
  it('marks a guest paid', () => {
    const tab = store.getTab();
    const guest = tab.guests[0];
    store.markPaid(guest.id);
    expect(guest.paid).toBe(true);
  });

  it('tab is not settled until all guests paid', () => {
    expect(store.isSettled()).toBe(false);
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
});
