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
  await page.locator('#identity-chips .chip', { hasText: 'Alice' }).click();
  await page.locator('#confirm-identity-btn').click();
  await expect(page.locator('#items-section')).toBeVisible();

  const wineItems = page.locator('.item', { hasText: 'Wine' });
  await expect(wineItems).toHaveCount(3);
  await expect(wineItems.first().locator('.item-price')).toHaveText('$10.00');
});
