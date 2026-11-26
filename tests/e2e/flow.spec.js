const { test, expect } = require('@playwright/test');

async function createTab(page, { guests = ['Alice', 'Bob'], items = [{ name: 'Beer', price: '5.00', qty: '2' }] } = {}) {
  await page.goto('/');
  await page.fill('#tab-name', 'E2E Test Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#charge-tax', '0.80');
  await page.fill('#charge-gratuity', '2.00');
  await page.fill('#guest-names', guests.join('\n'));

  for (const item of items) {
    await page.click('button:has-text("+ Add Item")');
    const rows = page.locator('.setup-item');
    const last = rows.last();
    await last.locator('.setup-item-name').fill(item.name);
    await last.locator('.setup-item-qty').fill(String(item.qty));
    await last.locator('.setup-item-price').fill(String(item.price));
  }

  await page.click('#create-btn');
  await page.waitForURL(/\/host\//);
  const tabId = page.url().split('/').filter(Boolean).pop();
  return tabId;
}

async function selectGuest(page, name) {
  await page.locator('#identity-chips .chip', { hasText: name }).click();
  await page.locator('#confirm-identity-btn').click();
  await expect(page.locator('#items-section')).toBeVisible();
}

test('setup page creates tab and redirects to host page', async ({ page }) => {
  const tabId = await createTab(page);
  expect(tabId).toHaveLength(6);
  await expect(page.locator('#tab-name')).toHaveText('E2E Test Tab');
  await expect(page.locator('#guest-url')).toContainText(`/tab/${tabId}`);
});

test('guest page shows identity picker then items after confirmation', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // Identity picker should be visible, items hidden
  await expect(page.locator('#identity-picker')).toBeVisible();
  await expect(page.locator('#items-section')).toBeHidden();

  // Confirm button disabled until a name is picked
  await expect(page.locator('#confirm-identity-btn')).toBeDisabled();

  // Select Alice and confirm
  await selectGuest(page, 'Alice');

  // Items now visible, identity picker hidden
  await expect(page.locator('#identity-picker')).toBeHidden();
  await expect(page.locator('.item').first()).toBeVisible();
});

test('guest can claim item and item shows as claimed-mine', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);
  await selectGuest(page, 'Alice');

  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);
});

test('claimed items persist after page refresh', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);
  await selectGuest(page, 'Alice');

  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);

  // Reload — identity persists in sessionStorage, item still claimed-mine
  await page.reload();
  await expect(page.locator('#items-section')).toBeVisible();
  await expect(page.locator('.item').first()).toHaveClass(/claimed-mine/);
});

test('host page marks guest as paid', async ({ page }) => {
  const tabId = await createTab(page, { guests: ['Alice'] });
  await page.waitForURL(`/host/${tabId}`);

  await page.locator('.guest-status-row', { hasText: 'Alice' }).locator('.btn-mark-paid').click();

  await expect(page.locator('.guest-status-row', { hasText: 'Alice' })).toHaveClass(/paid/, { timeout: 8000 });
});

test('items section hidden before identity is confirmed', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  await expect(page.locator('#identity-picker')).toBeVisible();
  await expect(page.locator('#items-section')).toBeHidden();
  await expect(page.locator('#footer')).toBeHidden();
});

test('split mode shows per-person label and sends divided price to server', async ({ page }) => {
  await page.goto('/');
  await page.fill('#tab-name', 'Split Test');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#guest-names', 'Alice\nBob\nCharlie');

  await page.click('button:has-text("+ Add Item")');
  const row = page.locator('.setup-item').last();
  await row.locator('.setup-item-name').fill('Wine');
  await row.locator('.setup-item-qty').fill('3');
  await row.locator('.setup-item-price').fill('30.00');
  // Toggle to split mode AFTER filling values so renderItems() sees qty=3, price=30
  await row.locator('.setup-item-operator').click();

  // Per-person label should show $10.00
  await expect(row.locator('.setup-item-each')).toHaveText('= $10.00 each');

  // Create the tab
  await page.click('#create-btn');
  await page.waitForURL(/\/host\//);
  const tabId = page.url().split('/').filter(Boolean).pop();

  // Guest page should show 3 claimable Wine items at $10.00 each
  await page.goto(`/tab/${tabId}`);
  await selectGuest(page, 'Alice');

  const wineItems = page.locator('.item', { hasText: 'Wine' });
  await expect(wineItems).toHaveCount(3);
  await expect(wineItems.first().locator('.item-price')).toHaveText('$10.00');
});

test('help icon opens and closes the help overlay on the setup page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#help-overlay')).toBeHidden();

  await page.click('#help-btn');
  await expect(page.locator('#help-overlay')).toBeVisible();

  await page.click('#help-close');
  await expect(page.locator('#help-overlay')).toBeHidden();
});

test('help overlay locks background scroll while open', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'visible');

  await page.click('#help-btn');
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'hidden');

  await page.click('#help-close');
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'visible');
});

test('item price field resolves a typed math expression on blur', async ({ page }) => {
  await page.goto('/');
  await page.click('button:has-text("+ Add Item")');
  const row = page.locator('.setup-item').last();
  await row.locator('.setup-item-name').fill('Miller Lite');
  await row.locator('.setup-item-qty').fill('4');

  const priceField = row.locator('.setup-item-price');
  await priceField.fill('24/4');
  await row.locator('.setup-item-name').click(); // blur the price field

  await expect(priceField).toHaveValue('6.00');
});

test('calculator keypad lets you build and resolve a math expression by tapping', async ({ page }) => {
  await page.goto('/');
  await page.click('button:has-text("+ Add Item")');
  const row = page.locator('.setup-item').last();
  const priceField = row.locator('.setup-item-price');

  await expect(page.locator('#calc-bar')).toBeHidden();
  await priceField.click();
  await expect(page.locator('#calc-bar')).toBeVisible();

  await page.click('[data-insert="2"]');
  await page.click('[data-insert="4"]');
  await page.click('[data-insert="/"]');
  await page.click('[data-insert="4"]');
  await page.click('#calc-bar-confirm');

  await expect(priceField).toHaveValue('6.00');
  await expect(page.locator('#calc-bar')).toBeHidden();
});

test('item price field never shows the native on-screen keyboard', async ({ page }) => {
  await page.goto('/');
  await page.click('button:has-text("+ Add Item")');
  const row = page.locator('.setup-item').last();
  await expect(row.locator('.setup-item-price')).toHaveAttribute('inputmode', 'none');
  await expect(row.locator('.setup-item-qty')).toHaveAttribute('inputmode', 'none');
});

test('receipt total mismatch warning updates live and turns green once prices are fixed', async ({ page }) => {
  await page.route('**/api/receipt/parse', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{ name: 'Nachos', price: 20, qty: 1 }],
      charges: { surcharge: 0, tax: 0, gratuity: 0 },
      receiptTotal: 24,
    }),
  }));

  await page.goto('/');
  await page.setInputFiles('#receipt-library', {
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake-image-data'),
  });

  const status = page.locator('#parse-status');
  await expect(status).toHaveClass(/warning/);
  await expect(status).toContainText('mismatch');

  const priceField = page.locator('.setup-item').first().locator('.setup-item-price');
  await priceField.click(); // selects the current value
  await page.click('#calc-bar-backspace'); // clears the selection
  await page.click('[data-insert="2"]');
  await page.click('[data-insert="4"]');
  await page.click('#calc-bar-confirm');

  await expect(status).toHaveClass(/success/);
  await expect(status).toContainText('matches');
});

test('tab created from a scanned receipt reports scanned: true', async ({ page }) => {
  await page.route('**/api/receipt/parse', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{ name: 'Nachos', price: 20, qty: 1 }],
      charges: { surcharge: 0, tax: 0, gratuity: 0 },
      receiptTotal: 20,
    }),
  }));
  await page.goto('/');
  await page.setInputFiles('#receipt-library', {
    name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('fake-image-data'),
  });
  await expect(page.locator('#parse-status')).toContainText('Found');
  await page.fill('#tab-name', 'Scanned Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#guest-names', 'Alice');
  const [req] = await Promise.all([
    page.waitForRequest(r => r.url().endsWith('/api/tabs') && r.method() === 'POST'),
    page.click('#create-btn'),
  ]);
  expect(req.postDataJSON().scanned).toBe(true);
});

test('manually entered tab reports scanned: false', async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r => r.url().endsWith('/api/tabs') && r.method() === 'POST'),
    createTab(page),
  ]);
  expect(req.postDataJSON().scanned).toBe(false);
});

test.describe('admin dashboard', () => {
  test.skip(!!process.env.BASE_URL, 'needs the local test server env');

  test('signs in via ?key=, strips it from the URL, and renders stats', async ({ page }) => {
    await createTab(page);
    await page.goto('/admin?key=e2e-admin-token');
    await expect(page.locator('#admin-grid')).toBeVisible();
    await expect(page.locator('#growth')).toContainText('Tabs · 7d');
    await expect(page.locator('#cost')).toContainText('/ 500');
    expect(page.url()).not.toContain('key=');
    await page.reload(); // remembered key
    await expect(page.locator('#admin-grid')).toBeVisible();
  });

  test('shows a message and hides stats for a wrong key', async ({ page }) => {
    await page.goto('/admin?key=wrong');
    await expect(page.locator('#admin-message')).toContainText('not accepted');
    await expect(page.locator('#admin-grid')).toBeHidden();
  });
});

test.describe('tip row', () => {
  test('shows $1 / $2 / Other linking to the tip Venmo profile on desktop', async ({ page }) => {
    await createTab(page);
    const row = page.locator('#tip-row');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Leave a tip!');
    await expect(row.locator('[data-amount="1"]')).toHaveAttribute('href', 'https://venmo.com/u/Caleb-Holland-3');
    await expect(row.locator('[data-amount="other"]')).toHaveText('Other');
  });

  test('records a tip tap', async ({ page }) => {
    await page.route('https://venmo.com/**', route => route.fulfill({ status: 200, body: 'venmo' }));
    await createTab(page);
    const [req] = await Promise.all([
      page.waitForRequest(r => r.url().endsWith('/api/events/tip')),
      page.locator('#tip-row [data-amount="2"]').click(),
    ]);
    expect(JSON.parse(req.postData())).toMatchObject({ amount: 2 });
  });

  test('tip row stays hidden when no handle is configured', async ({ page }) => {
    await page.route('**/api/config', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ tipHandle: null }),
    }));
    await createTab(page);
    await expect(page.locator('#guest-url')).toContainText('/tab/');
    await expect(page.locator('#tip-row')).toBeHidden();
  });
});

test.describe('tip row on mobile', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });

  test('deep-links into the Venmo app with the amount pre-filled', async ({ page }) => {
    // Create via API: the setup form's keypad behaves differently under a mobile UA.
    const res = await page.request.post('/api/tabs', { data: {
      name: 'Mobile Tab', paymentHandle: '@tester', paymentPlatform: 'Venmo',
      charges: { subtotal: 10, surcharge: 0, tax: 0, gratuity: 0, total: 10 },
      guests: ['Alice'], items: [{ name: 'Beer', price: 10, qty: 1 }],
    } });
    const { tabId } = await res.json();
    await page.goto(`/host/${tabId}`);
    await expect(page.locator('#tip-row [data-amount="1"]'))
      .toHaveAttribute('href', 'venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&amount=1.00&note=TabSplitter%20tip');
    await expect(page.locator('#tip-row [data-amount="other"]'))
      .toHaveAttribute('href', 'venmo://paycharge?txn=pay&recipients=Caleb-Holland-3&note=TabSplitter%20tip');
  });
});
