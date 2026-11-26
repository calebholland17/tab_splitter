const { venmoUrl } = require('../public/js/venmo');

describe('venmoUrl', () => {
  it('opens the profile page on desktop regardless of amount', () => {
    expect(venmoUrl('@Caleb-Holland-3', 1, 'TabSplitter tip', false)).toBe('https://venmo.com/u/Caleb-Holland-3');
  });

  it('builds a deep link with amount and note on mobile', () => {
    expect(venmoUrl('Caleb-Holland-3', 1, 'TabSplitter tip', true))
      .toBe('venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&amount=1.00&note=TabSplitter%20tip');
  });

  it('omits the amount when it is null (the "Other" tip)', () => {
    expect(venmoUrl('Caleb-Holland-3', null, 'TabSplitter tip', true))
      .toBe('venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&note=TabSplitter%20tip');
  });

  it('keeps amount=0.00 for a zero amount (existing guest badge behavior)', () => {
    expect(venmoUrl('@host', 0, 'Dinner', true)).toContain('&amount=0.00&');
  });
});
