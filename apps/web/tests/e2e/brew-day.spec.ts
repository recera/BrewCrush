import { test, expect, devices } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Use iPhone 13 Pro viewport for mobile testing
test.use({
  ...devices['iPhone 13 Pro'],
  permissions: ['clipboard-read', 'clipboard-write'],
});

// Test data
const TEST_WORKSPACE_ID = 'test-workspace-e2e';
const TEST_USER_EMAIL = 'brewer@test.com';
const TEST_USER_PASSWORD = 'test123456';

test.describe('Brew Day Mobile Workflow', () => {
  let supabase: any;

  test.beforeAll(async () => {
    // Setup test database with sample data
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create test workspace and user
    await supabase.auth.admin.createUser({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
    });

    // Insert test data
    await supabase.from('workspaces').insert({
      id: TEST_WORKSPACE_ID,
      name: 'E2E Test Brewery',
      plan: 'starter',
    });

    await supabase.from('recipes').insert({
      id: 'test-recipe-e2e',
      workspace_id: TEST_WORKSPACE_ID,
      name: 'Test IPA',
      style: 'IPA',
      target_volume: 100,
      target_og: 1.055,
    });

    await supabase.from('tanks').insert({
      id: 'test-tank-e2e',
      workspace_id: TEST_WORKSPACE_ID,
      name: 'FV1',
      type: 'fermenter',
      capacity: 120,
      is_active: true,
    });

    await supabase.from('batches').insert({
      id: 'test-batch-e2e',
      workspace_id: TEST_WORKSPACE_ID,
      batch_number: 'B-TEST-001',
      recipe_version_id: 'test-version-e2e',
      tank_id: 'test-tank-e2e',
      status: 'planned',
      target_volume: 100,
    });
  });

  test.afterAll(async () => {
    // Cleanup test data
    await supabase.from('batches').delete().eq('id', 'test-batch-e2e');
    await supabase.from('tanks').delete().eq('id', 'test-tank-e2e');
    await supabase.from('recipes').delete().eq('id', 'test-recipe-e2e');
    await supabase.from('workspaces').delete().eq('id', TEST_WORKSPACE_ID);
    await supabase.auth.admin.deleteUser(TEST_USER_EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[name="email"]', TEST_USER_EMAIL);
    await page.fill('input[name="password"]', TEST_USER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should display mobile-optimized brew day interface', async ({ page }) => {
    await page.goto(`/batches/${test-batch-e2e}/brew-day`);
    
    // Check for mobile-optimized layout
    await expect(page.locator('[data-testid="brew-day-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="brew-day-checklist"]')).toBeVisible();
    
    // Verify large touch targets (min 44px)
    const buttons = await page.locator('button').all();
    for (const button of buttons) {
      const box = await button.boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('should handle offline mode gracefully', async ({ page, context }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Go offline
    await context.setOffline(true);
    
    // Check for offline indicator
    await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible();
    
    // Try to log a reading while offline
    await page.click('[data-testid="log-measurement-btn"]');
    await page.fill('input[name="og"]', '1.055');
    await page.fill('input[name="volume"]', '98');
    await page.click('[data-testid="save-measurement"]');
    
    // Check that action was queued
    await expect(page.locator('[data-testid="outbox-counter"]')).toContainText('1');
    
    // Go back online
    await context.setOffline(false);
    
    // Wait for sync
    await page.waitForTimeout(2000);
    
    // Verify outbox is cleared
    await expect(page.locator('[data-testid="outbox-counter"]')).toContainText('0');
  });

  test('should complete brew day checklist items', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Complete checklist items
    const checklistItems = [
      'sanitize-equipment',
      'heat-water',
      'add-grains',
      'mash-in',
      'vorlauf',
      'sparge',
      'boil-start',
      'hop-addition-1',
      'whirlpool',
      'cool-wort',
      'transfer-fermenter',
      'pitch-yeast',
    ];
    
    for (const item of checklistItems) {
      const checkbox = page.locator(`[data-testid="checklist-${item}"]`);
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
    
    // Verify progress
    const progress = await page.locator('[data-testid="checklist-progress"]').textContent();
    expect(progress).toContain('100%');
  });

  test('should manage brew day timers', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Start mash timer
    await page.click('[data-testid="start-mash-timer"]');
    await page.fill('input[name="timer-duration"]', '60');
    await page.click('[data-testid="confirm-timer"]');
    
    // Check timer is running
    await expect(page.locator('[data-testid="mash-timer-display"]')).toBeVisible();
    
    // Pause timer
    await page.click('[data-testid="pause-timer"]');
    const pausedTime = await page.locator('[data-testid="mash-timer-display"]').textContent();
    
    // Wait and verify timer is paused
    await page.waitForTimeout(2000);
    const currentTime = await page.locator('[data-testid="mash-timer-display"]').textContent();
    expect(currentTime).toBe(pausedTime);
    
    // Complete timer
    await page.click('[data-testid="complete-timer"]');
    await expect(page.locator('[data-testid="mash-timer-complete"]')).toBeVisible();
  });

  test('should record actual measurements', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Open measurements dialog
    await page.click('[data-testid="record-measurements"]');
    
    // Fill in actual values
    await page.fill('input[name="actual_og"]', '1.053');
    await page.fill('input[name="actual_volume"]', '95');
    await page.fill('input[name="pre_boil_sg"]', '1.045');
    await page.fill('textarea[name="notes"]', 'Slightly lower efficiency than expected');
    
    // Save measurements
    await page.click('[data-testid="save-measurements"]');
    
    // Verify saved values are displayed
    await expect(page.locator('[data-testid="actual-og-display"]')).toContainText('1.053');
    await expect(page.locator('[data-testid="actual-volume-display"]')).toContainText('95 L');
  });

  test('should handle lot override with COGS preview', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Open lot override dialog
    await page.click('[data-testid="override-lot-btn"]');
    
    // Select non-FIFO lot
    await page.click('[data-testid="lot-option-2"]');
    
    // Check COGS delta is displayed
    await expect(page.locator('[data-testid="cogs-delta"]')).toBeVisible();
    const cogsDelta = await page.locator('[data-testid="cogs-delta"]').textContent();
    expect(cogsDelta).toMatch(/[+-]\$\d+\.\d{2}/);
    
    // Confirm override
    await page.click('[data-testid="confirm-override"]');
    
    // Verify override is applied
    await expect(page.locator('[data-testid="lot-override-indicator"]')).toBeVisible();
  });

  test('should transition batch status on brew day completion', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Complete all required steps
    await page.click('[data-testid="complete-brew-day"]');
    
    // Confirm completion
    await page.click('[data-testid="confirm-complete"]');
    
    // Check batch status updated
    const { data: batch } = await supabase
      .from('batches')
      .select('status')
      .eq('id', 'test-batch-e2e')
      .single();
    
    expect(batch.status).toBe('fermenting');
  });

  test('should persist timer state across page refreshes', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Start a timer
    await page.click('[data-testid="start-boil-timer"]');
    await page.fill('input[name="timer-duration"]', '90');
    await page.click('[data-testid="confirm-timer"]');
    
    // Wait for timer to count down
    await page.waitForTimeout(3000);
    const timeBeforeRefresh = await page.locator('[data-testid="boil-timer-display"]').textContent();
    
    // Refresh page
    await page.reload();
    
    // Check timer is still running with correct time
    const timeAfterRefresh = await page.locator('[data-testid="boil-timer-display"]').textContent();
    
    // Parse times and verify continuity (allowing 2 second difference for reload time)
    const parseTime = (time: string) => {
      const [minutes, seconds] = time.split(':').map(Number);
      return minutes * 60 + seconds;
    };
    
    const timeDiff = Math.abs(parseTime(timeBeforeRefresh!) - parseTime(timeAfterRefresh!));
    expect(timeDiff).toBeLessThanOrEqual(2);
  });

  test('should handle yeast pitch recording', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Open yeast pitch dialog
    await page.click('[data-testid="pitch-yeast-btn"]');
    
    // Select yeast batch
    await page.selectOption('select[name="yeast_batch_id"]', { label: 'US-05 - Gen 0' });
    
    // Add pitch notes
    await page.fill('textarea[name="pitch_notes"]', 'Pitched at 18°C, healthy starter');
    
    // Confirm pitch
    await page.click('[data-testid="confirm-pitch"]');
    
    // Verify yeast is marked as pitched
    await expect(page.locator('[data-testid="yeast-pitched-indicator"]')).toBeVisible();
  });

  test('should validate required fields before completion', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Try to complete without required measurements
    await page.click('[data-testid="complete-brew-day"]');
    
    // Should show validation errors
    await expect(page.locator('[data-testid="validation-error"]')).toContainText('Please record actual OG and volume');
    
    // Record required measurements
    await page.click('[data-testid="record-measurements"]');
    await page.fill('input[name="actual_og"]', '1.055');
    await page.fill('input[name="actual_volume"]', '100');
    await page.click('[data-testid="save-measurements"]');
    
    // Try again - should work now
    await page.click('[data-testid="complete-brew-day"]');
    await expect(page.locator('[data-testid="confirm-complete"]')).toBeVisible();
  });
});

test.describe('Brew Day Desktop Workflow', () => {
  // Use desktop viewport
  test.use({
    viewport: { width: 1920, height: 1080 },
  });

  test('should display desktop layout with proper information density', async ({ page }) => {
    await page.goto(`/batches/test-batch-e2e/brew-day`);
    
    // Check for desktop layout elements
    await expect(page.locator('[data-testid="recipe-sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="measurements-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="timer-dock"]')).toBeVisible();
    
    // Verify multi-column layout
    const mainContent = await page.locator('[data-testid="main-content"]').boundingBox();
    const sidebar = await page.locator('[data-testid="recipe-sidebar"]').boundingBox();
    
    // Sidebar should be beside main content, not below
    expect(sidebar?.y).toBeLessThanOrEqual(mainContent?.y! + 50);
  });
});