import { test, expect, devices } from '@playwright/test';

// Test multiple mobile viewports
const mobileDevices = [
  { name: 'iPhone 13 Pro', device: devices['iPhone 13 Pro'] },
  { name: 'Pixel 5', device: devices['Pixel 5'] },
  { name: 'iPad Mini', device: devices['iPad Mini'] },
];

mobileDevices.forEach(({ name, device }) => {
  test.describe(`Mobile UI Verification - ${name}`, () => {
    test.use(device);

    test.beforeEach(async ({ page }) => {
      // Mock authentication
      await page.addInitScript(() => {
        window.localStorage.setItem('supabase.auth.token', JSON.stringify({
          access_token: 'mock-token',
          user: { id: 'test-user', email: 'test@example.com' }
        }));
      });
    });

    test('should have mobile-optimized navigation', async ({ page }) => {
      await page.goto('/dashboard');
      
      // Check for mobile navigation elements
      const mobileMenu = page.locator('[data-testid="mobile-menu-button"]');
      const desktopNav = page.locator('[data-testid="desktop-nav"]');
      
      // Mobile menu should be visible, desktop nav hidden
      await expect(mobileMenu).toBeVisible();
      await expect(desktopNav).toBeHidden();
      
      // Open mobile menu
      await mobileMenu.click();
      await expect(page.locator('[data-testid="mobile-nav-drawer"]')).toBeVisible();
      
      // Check navigation items are touch-friendly
      const navItems = await page.locator('[data-testid="mobile-nav-item"]').all();
      for (const item of navItems) {
        const box = await item.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44); // iOS minimum touch target
      }
    });

    test('should use numeric keypad for measurements', async ({ page }) => {
      await page.goto('/batches/test-batch/brew-day');
      
      // Click on OG input
      await page.click('input[name="og"]');
      
      // Check input type is set for numeric keypad
      const inputMode = await page.locator('input[name="og"]').getAttribute('inputmode');
      expect(inputMode).toBe('decimal');
      
      // Check for temperature input
      const tempInput = page.locator('input[name="temperature"]');
      const tempInputMode = await tempInput.getAttribute('inputmode');
      expect(tempInputMode).toBe('numeric');
    });

    test('should have swipeable tank cards', async ({ page }) => {
      await page.goto('/tanks');
      
      const tankCard = page.locator('[data-testid="tank-card"]').first();
      const box = await tankCard.boundingBox();
      
      if (box) {
        // Simulate swipe gesture
        await page.mouse.move(box.x + box.width - 50, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        
        // Check if quick actions are revealed
        await expect(page.locator('[data-testid="tank-quick-actions"]')).toBeVisible();
      }
    });

    test('should display responsive tables', async ({ page }) => {
      await page.goto('/inventory/items');
      
      // On mobile, tables should be scrollable or card-based
      const table = page.locator('[data-testid="inventory-table"]');
      const cards = page.locator('[data-testid="inventory-card"]');
      
      // Either table with horizontal scroll or cards should be visible
      const isTableVisible = await table.isVisible().catch(() => false);
      const areCardsVisible = await cards.first().isVisible().catch(() => false);
      
      expect(isTableVisible || areCardsVisible).toBeTruthy();
      
      if (isTableVisible) {
        // Check table has horizontal scroll
        const tableContainer = page.locator('[data-testid="table-scroll-container"]');
        const containerBox = await tableContainer.boundingBox();
        const tableBox = await table.boundingBox();
        
        // Table should be wider than container (scrollable)
        expect(tableBox?.width).toBeGreaterThan(containerBox?.width || 0);
      }
    });

    test('should show offline indicator prominently', async ({ page, context }) => {
      await page.goto('/dashboard');
      
      // Go offline
      await context.setOffline(true);
      
      // Check offline banner is visible and positioned correctly
      const offlineBanner = page.locator('[data-testid="offline-banner"]');
      await expect(offlineBanner).toBeVisible();
      
      // Banner should be at the top of the viewport
      const box = await offlineBanner.boundingBox();
      expect(box?.y).toBeLessThanOrEqual(100);
      
      // Check for queue counter
      await expect(page.locator('[data-testid="offline-queue-count"]')).toBeVisible();
    });

    test('should have touch-optimized form inputs', async ({ page }) => {
      await page.goto('/recipes/new');
      
      // Check all form inputs have adequate spacing
      const inputs = await page.locator('input, select, textarea, button').all();
      
      for (const input of inputs) {
        const box = await input.boundingBox();
        if (box) {
          // Minimum touch target size
          expect(box.height).toBeGreaterThanOrEqual(44);
          
          // Check for adequate spacing between inputs
          const style = await input.evaluate(el => 
            window.getComputedStyle(el)
          );
          const marginBottom = parseInt(style.marginBottom);
          expect(marginBottom).toBeGreaterThanOrEqual(8);
        }
      }
    });

    test('should display modal dialogs appropriately', async ({ page }) => {
      await page.goto('/yeast');
      
      // Open create dialog
      await page.click('[data-testid="create-yeast-batch"]');
      
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      
      // Dialog should be full-screen or near full-screen on mobile
      const viewport = page.viewportSize();
      const dialogBox = await dialog.boundingBox();
      
      if (viewport && dialogBox) {
        // Dialog should take up most of the viewport
        expect(dialogBox.width).toBeGreaterThan(viewport.width * 0.9);
        
        // On phones, it should be near full height
        if (viewport.width < 768) {
          expect(dialogBox.height).toBeGreaterThan(viewport.height * 0.8);
        }
      }
    });

    test('should have sticky action buttons', async ({ page }) => {
      await page.goto('/batches/test-batch/brew-day');
      
      // Scroll down
      await page.evaluate(() => window.scrollTo(0, 500));
      
      // Primary action button should remain visible
      const actionButton = page.locator('[data-testid="primary-action-button"]');
      await expect(actionButton).toBeInViewport();
      
      // Check it's positioned at the bottom
      const box = await actionButton.boundingBox();
      const viewport = page.viewportSize();
      
      if (box && viewport) {
        expect(box.y + box.height).toBeGreaterThan(viewport.height - 100);
      }
    });

    test('should handle long lists with virtualization', async ({ page }) => {
      await page.goto('/inventory/items');
      
      // Check for virtualized list indicator
      const virtualList = page.locator('[data-testid="virtual-list"]');
      const isVirtualized = await virtualList.count() > 0;
      
      if (isVirtualized) {
        // Scroll and check that DOM nodes are recycled
        const initialItems = await page.locator('[data-testid="list-item"]').count();
        
        await page.evaluate(() => window.scrollTo(0, 1000));
        await page.waitForTimeout(100);
        
        const scrolledItems = await page.locator('[data-testid="list-item"]').count();
        
        // Virtual list should maintain roughly the same number of DOM nodes
        expect(Math.abs(scrolledItems - initialItems)).toBeLessThanOrEqual(5);
      }
    });

    test('should support pull-to-refresh gesture', async ({ page }) => {
      await page.goto('/tanks');
      
      // Simulate pull-to-refresh
      const tankBoard = page.locator('[data-testid="tank-board"]');
      const box = await tankBoard.boundingBox();
      
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + 50);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 10 });
        
        // Check for refresh indicator
        await expect(page.locator('[data-testid="pull-refresh-indicator"]')).toBeVisible();
        
        await page.mouse.up();
        
        // Check data is refreshing
        await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible();
      }
    });

    test('should have optimized image loading', async ({ page }) => {
      await page.goto('/recipes');
      
      // Check images use lazy loading
      const images = await page.locator('img').all();
      
      for (const img of images) {
        const loading = await img.getAttribute('loading');
        expect(loading).toBe('lazy');
        
        // Check for responsive images
        const srcset = await img.getAttribute('srcset');
        if (srcset) {
          // Should have multiple resolutions
          expect(srcset.split(',').length).toBeGreaterThanOrEqual(2);
        }
      }
    });

    test('should handle orientation changes', async ({ page, context }) => {
      if (name !== 'iPad Mini') { // Only test on phones
        await page.goto('/batches/test-batch/brew-day');
        
        // Portrait orientation
        await page.setViewportSize({ width: 390, height: 844 });
        let layout = await page.locator('[data-testid="layout-container"]').getAttribute('data-orientation');
        expect(layout).toBe('portrait');
        
        // Landscape orientation
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(500); // Wait for orientation change
        layout = await page.locator('[data-testid="layout-container"]').getAttribute('data-orientation');
        expect(layout).toBe('landscape');
        
        // In landscape, check for optimized layout
        const sidebar = page.locator('[data-testid="landscape-sidebar"]');
        await expect(sidebar).toBeVisible();
      }
    });

    test('should provide haptic feedback triggers', async ({ page }) => {
      await page.goto('/batches/test-batch/brew-day');
      
      // Check for haptic feedback data attributes
      const buttons = await page.locator('button[data-haptic]').all();
      
      for (const button of buttons) {
        const hapticType = await button.getAttribute('data-haptic');
        expect(['light', 'medium', 'heavy', 'success', 'warning', 'error']).toContain(hapticType);
      }
    });

    test('should handle network latency gracefully', async ({ page, context }) => {
      // Simulate slow 3G
      await context.route('**/*', route => {
        setTimeout(() => route.continue(), 1000);
      });
      
      await page.goto('/dashboard');
      
      // Should show loading states
      await expect(page.locator('[data-testid="skeleton-loader"]')).toBeVisible();
      
      // Eventually content should load
      await expect(page.locator('[data-testid="dashboard-content"]')).toBeVisible({ timeout: 10000 });
    });

    test('should have accessible touch targets in dense areas', async ({ page }) => {
      await page.goto('/recipes/test-recipe');
      
      // Check ingredient list with many items
      const ingredientRows = await page.locator('[data-testid="ingredient-row"]').all();
      
      for (let i = 0; i < Math.min(ingredientRows.length - 1, 5); i++) {
        const current = await ingredientRows[i].boundingBox();
        const next = await ingredientRows[i + 1].boundingBox();
        
        if (current && next) {
          // Check vertical spacing between rows
          const spacing = next.y - (current.y + current.height);
          expect(spacing).toBeGreaterThanOrEqual(4);
          
          // Each row should be tall enough
          expect(current.height).toBeGreaterThanOrEqual(44);
        }
      }
    });
  });
});

// Test PWA-specific features
test.describe('PWA Features', () => {
  test.use(devices['iPhone 13 Pro']);

  test('should register service worker', async ({ page }) => {
    await page.goto('/');
    
    const swRegistered = await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration !== undefined;
      }
      return false;
    });
    
    expect(swRegistered).toBeTruthy();
  });

  test('should cache critical assets', async ({ page }) => {
    await page.goto('/');
    
    const cachedAssets = await page.evaluate(async () => {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        const cache = await caches.open(cacheNames[0]);
        const keys = await cache.keys();
        return keys.map(req => req.url);
      }
      return [];
    });
    
    // Check critical assets are cached
    expect(cachedAssets.some(url => url.includes('/manifest.json'))).toBeTruthy();
    expect(cachedAssets.some(url => url.includes('.js'))).toBeTruthy();
    expect(cachedAssets.some(url => url.includes('.css'))).toBeTruthy();
  });

  test('should handle app install prompt', async ({ page }) => {
    await page.goto('/');
    
    // Check for install prompt handler
    const hasInstallHandler = await page.evaluate(() => {
      return window.hasOwnProperty('onbeforeinstallprompt');
    });
    
    if (hasInstallHandler) {
      // Trigger install prompt
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        window.dispatchEvent(event);
      });
      
      // Check install button appears
      await expect(page.locator('[data-testid="install-app-button"]')).toBeVisible();
    }
  });
});