const { test, expect } = require('@playwright/test');

async function createTab(page, { guests = ['Alice', 'Bob'], items = [{ name: 'Beer', price: '5.00', qty: '2' }] } = {}) {
  await page.goto('/');
  await page.fill('#tab-name', 'E2E Test Tab');
  await page.fill('#payment-handle', '@tester');
  await page.fill('#charge-tax', '0.80');
  await page.fill('#charge-gratuity', '2.00');
  await page.fill('#guest-names', guests.join('\n'));

  // Add items manually
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

test('setup page creates tab and redirects to host page', async ({ page }) => {
  const tabId = await createTab(page);
  expect(tabId).toHaveLength(6);
  await expect(page.locator('#tab-name')).toHaveText('E2E Test Tab');
  await expect(page.locator('#guest-url')).toContainText(`/tab/${tabId}`);
});

test('guest page shows items and allows claiming', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // Items should be visible but dimmed (no name selected)
  await expect(page.locator('.item').first()).toBeVisible();
  await expect(page.locator('.chip').first()).toBeVisible();

  // Select Alice
  await page.locator('.chip', { hasText: 'Alice' }).click();

  // Claim first item
  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);
});

test('claimed items persist after page refresh', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  await page.locator('.chip', { hasText: 'Alice' }).click();
  const firstItem = page.locator('.item').first();
  await firstItem.click();
  await expect(firstItem).toHaveClass(/claimed-mine/);

  // Reload the page
  await page.reload();

  // Item should still be claimed (shown as claimed-other since no name re-selected)
  await expect(page.locator('.item').first()).toHaveClass(/claimed-other/);

  // Re-select Alice and confirm it's hers
  await page.locator('.chip', { hasText: 'Alice' }).click();
  await expect(page.locator('.item').first()).toHaveClass(/claimed-mine/);
});

test('host page updates when guest pays', async ({ page, context }) => {
  const tabId = await createTab(page, { guests: ['Alice'] });
  const hostPage = page;

  // Open guest page in new tab
  const guestPage = await context.newPage();
  await guestPage.goto(`/tab/${tabId}`);
  await guestPage.locator('.chip', { hasText: 'Alice' }).click();
  await guestPage.locator('#settle-btn').click();

  // Host page should show Alice as paid within 3 seconds
  await hostPage.waitForTimeout(3000);
  await hostPage.reload();
  await expect(hostPage.locator('.guest-status-row')).toHaveClass(/paid/);
});

test('no items appear selected before name is chosen', async ({ page }) => {
  const tabId = await createTab(page);
  await page.goto(`/tab/${tabId}`);

  // All items should have no-guest class (dimmed)
  const items = page.locator('.item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    await expect(items.nth(i)).toHaveClass(/no-guest/);
  }
});
