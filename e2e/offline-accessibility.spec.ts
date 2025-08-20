import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test.describe('Offline Mode Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    
    // Inject axe for accessibility testing
    await injectAxe(page);
  });

  test('offline banner should be accessible', async ({ page, context }) => {
    // Login first
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Simulate going offline
    await context.setOffline(true);
    
    // Wait for offline banner to appear
    await page.waitForSelector('[role="alert"]', { timeout: 5000 });
    
    // Check accessibility of offline banner
    await checkA11y(page, '[role="alert"]', {
      detailedReport: true,
      detailedReportOptions: {
        html: true
      }
    });

    // Verify ARIA attributes
    const banner = page.locator('[role="alert"]');
    await expect(banner).toHaveAttribute('aria-live', 'polite');
    
    // Verify banner content is readable
    await expect(banner).toContainText("You're offline");
    
    // Check color contrast
    const bgColor = await banner.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    const textColor = await banner.evaluate(el => 
      window.getComputedStyle(el).color
    );
    
    // Banner should be visible and have sufficient contrast
    await expect(banner).toBeVisible();
    
    // Test keyboard navigation
    await page.keyboard.press('Tab');
    // Banner should not trap focus
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).not.toBe('DIV'); // Banner shouldn't capture focus
  });

  test('outbox tray should be accessible', async ({ page, context }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Add some items to outbox by going offline and performing actions
    await context.setOffline(true);
    
    // Trigger an offline action (e.g., update inventory)
    await page.goto('/inventory');
    await page.click('button:has-text("Adjust Inventory")');
    await page.fill('input[name="adjustment"]', '10');
    await page.click('button:has-text("Save")');
    
    // Check outbox tray button
    const outboxButton = page.locator('button[aria-label*="Offline queue"]');
    await expect(outboxButton).toBeVisible();
    
    // Check accessibility of outbox button
    await checkA11y(page, 'button[aria-label*="Offline queue"]');
    
    // Verify ARIA label updates with queue count
    await expect(outboxButton).toHaveAttribute('aria-label', /Offline queue: \d+ items?/);
    
    // Open outbox tray
    await outboxButton.click();
    
    // Wait for sheet to open
    await page.waitForSelector('[role="dialog"]');
    
    // Check accessibility of outbox tray
    await checkA11y(page, '[role="dialog"]', {
      rules: {
        'color-contrast': { enabled: true },
        'aria-required-attr': { enabled: true },
        'aria-valid-attr': { enabled: true }
      }
    });
    
    // Test keyboard navigation within tray
    await page.keyboard.press('Tab');
    let focusedElement = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focusedElement).toBeTruthy();
    
    // Test escape key closes tray
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('queue items should have proper ARIA labels', async ({ page, context }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Go offline and create queue items
    await context.setOffline(true);
    
    // Perform multiple actions
    await page.goto('/batches');
    await page.click('button:has-text("Log Reading")');
    await page.fill('input[name="sg"]', '1.050');
    await page.fill('input[name="temp"]', '68');
    await page.click('button:has-text("Save")');
    
    // Open outbox tray
    await page.click('button[aria-label*="Offline queue"]');
    await page.waitForSelector('[role="dialog"]');
    
    // Check each queue item for accessibility
    const queueItems = page.locator('[role="dialog"] [role="article"]');
    const itemCount = await queueItems.count();
    
    for (let i = 0; i < itemCount; i++) {
      const item = queueItems.nth(i);
      
      // Each item should have action buttons with proper labels
      const retryButton = item.locator('button[aria-label="Retry this action"]');
      const removeButton = item.locator('button[aria-label="Remove from queue"]');
      const expandButton = item.locator('button[aria-label*="Expand details"], button[aria-label*="Collapse details"]');
      
      if (await retryButton.isVisible()) {
        await expect(retryButton).toHaveAttribute('aria-label', 'Retry this action');
      }
      
      await expect(removeButton).toHaveAttribute('aria-label', 'Remove from queue');
      await expect(expandButton).toHaveAttribute('aria-label', /(Expand|Collapse) details/);
    }
  });

  test('conflict resolver should be accessible', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Simulate a conflict (this would normally happen during sync)
    await page.evaluate(() => {
      // Trigger conflict resolver UI
      window.dispatchEvent(new CustomEvent('sync-conflict', {
        detail: {
          type: 'data_conflict',
          operation: 'inventory.adjust',
          localData: { item_id: '123', qty: 10 },
          serverData: { item_id: '123', qty: 15 }
        }
      }));
    });
    
    // Wait for conflict dialog
    await page.waitForSelector('[role="dialog"]:has-text("Conflict")', { timeout: 5000 });
    
    // Check accessibility of conflict resolver
    await checkA11y(page, '[role="dialog"]');
    
    // Test radio group navigation
    const radioGroup = page.locator('[role="radiogroup"]');
    await expect(radioGroup).toBeVisible();
    
    // Each option should be keyboard navigable
    await radioGroup.locator('input[type="radio"]').first().focus();
    await page.keyboard.press('ArrowDown');
    
    const focusedRadio = await page.evaluate(() => 
      (document.activeElement as HTMLInputElement)?.value
    );
    expect(focusedRadio).toBeTruthy();
    
    // Labels should be associated with radio buttons
    const radioButtons = radioGroup.locator('input[type="radio"]');
    const radioCount = await radioButtons.count();
    
    for (let i = 0; i < radioCount; i++) {
      const radio = radioButtons.nth(i);
      const id = await radio.getAttribute('id');
      const label = page.locator(`label[for="${id}"]`);
      await expect(label).toBeVisible();
    }
  });

  test('notification preferences should be accessible', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Navigate to notification settings
    await page.goto('/settings/notifications');
    
    // Check accessibility of notification preferences
    await checkA11y(page, 'main');
    
    // Check form controls
    const switches = page.locator('[role="switch"]');
    const switchCount = await switches.count();
    
    for (let i = 0; i < switchCount; i++) {
      const switchControl = switches.nth(i);
      
      // Each switch should have an accessible label
      const id = await switchControl.getAttribute('id');
      const label = page.locator(`label[for="${id}"]`);
      await expect(label).toBeVisible();
      
      // Switch should have proper ARIA attributes
      await expect(switchControl).toHaveAttribute('role', 'switch');
      const checked = await switchControl.getAttribute('aria-checked');
      expect(['true', 'false']).toContain(checked);
    }
    
    // Time picker should be accessible
    const timePicker = page.locator('input[type="time"]');
    if (await timePicker.isVisible()) {
      await expect(timePicker).toHaveAttribute('aria-label', /digest time/i);
    }
  });

  test('focus management during sync', async ({ page, context }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Go offline
    await context.setOffline(true);
    
    // Perform action
    await page.goto('/inventory');
    const firstButton = page.locator('button').first();
    await firstButton.focus();
    
    // Store initial focus
    const initialFocus = await page.evaluate(() => document.activeElement?.id);
    
    // Go back online (triggers sync)
    await context.setOffline(false);
    
    // Wait for sync to complete
    await page.waitForTimeout(1000);
    
    // Focus should be preserved
    const currentFocus = await page.evaluate(() => document.activeElement?.id);
    expect(currentFocus).toBe(initialFocus);
  });

  test('screen reader announcements', async ({ page, context }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Check for ARIA live regions
    const liveRegions = page.locator('[aria-live]');
    const liveRegionCount = await liveRegions.count();
    expect(liveRegionCount).toBeGreaterThan(0);
    
    // Go offline
    await context.setOffline(true);
    
    // Check that status change is announced
    const statusRegion = page.locator('[aria-live="polite"]');
    await expect(statusRegion).toContainText(/offline/i);
    
    // Go back online
    await context.setOffline(false);
    
    // Status should update
    await page.waitForTimeout(500);
    const onlineStatus = await statusRegion.textContent();
    expect(onlineStatus).not.toContain('offline');
  });

  test('color contrast in different themes', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', 'test@brewery.com');
    await page.fill('input[type="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Test light theme
    await checkA11y(page, 'body', {
      rules: {
        'color-contrast': { enabled: true }
      }
    });
    
    // Switch to dark theme if available
    const themeToggle = page.locator('button[aria-label*="theme"]');
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(500);
      
      // Test dark theme
      await checkA11y(page, 'body', {
        rules: {
          'color-contrast': { enabled: true }
        }
      });
    }
  });
});