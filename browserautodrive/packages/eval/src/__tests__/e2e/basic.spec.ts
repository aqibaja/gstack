import { test, expect } from '@playwright/test';

test.describe('BrowserAutoDrive E2E', () => {
  test('should navigate to example.com', async ({ page }) => {
    await page.goto('https://example.com');
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test('should have accessible page content', async ({ page }) => {
    await page.goto('https://example.com');
    const heading = page.locator('h1');
    await expect(heading).toHaveText('Example Domain');
  });
});
