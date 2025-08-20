import { test, expect } from '@playwright/test'

// Test user credentials for different roles
const TEST_USERS = {
  admin: {
    email: 'admin@brewcrushtest.com',
    password: 'TestPassword123!',
    role: 'admin',
  },
  brewer: {
    email: 'brewer@brewcrushtest.com',
    password: 'TestPassword123!',
    role: 'brewer',
  },
  inventory: {
    email: 'inventory@brewcrushtest.com',
    password: 'TestPassword123!',
    role: 'inventory',
  },
  accounting: {
    email: 'accounting@brewcrushtest.com',
    password: 'TestPassword123!',
    role: 'accounting',
  },
  contractViewer: {
    email: 'contract@brewcrushtest.com',
    password: 'TestPassword123!',
    role: 'contract_viewer',
  },
}

// Helper function to login as a specific role
async function loginAs(page: any, role: keyof typeof TEST_USERS) {
  const user = TEST_USERS[role]
  await page.goto('/auth/login')
  await page.fill('input[type="email"]', user.email)
  await page.fill('input[type="password"]', user.password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/dashboard')
}

test.describe('Role-Based Navigation', () => {
  test.describe('Admin Role', () => {
    test('Admin can access all navigation items', async ({ page }) => {
      await loginAs(page, 'admin')

      // Check all navigation items are visible
      await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Production")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Inventory")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Purchasing")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Recipes")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Reports")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Compliance")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Settings")')).toBeVisible()

      // Check Invite Team button is visible
      await expect(page.locator('a:has-text("Invite Team")')).toBeVisible()
    })

    test('Admin can navigate to all sections', async ({ page }) => {
      await loginAs(page, 'admin')

      // Test navigation to each section
      const sections = [
        { name: 'Production', url: '/production' },
        { name: 'Inventory', url: '/inventory' },
        { name: 'Purchasing', url: '/purchasing' },
        { name: 'Recipes', url: '/recipes' },
        { name: 'Reports', url: '/reports' },
        { name: 'Compliance', url: '/compliance' },
        { name: 'Settings', url: '/settings' },
      ]

      for (const section of sections) {
        await page.click(`nav a:has-text("${section.name}")`)
        await expect(page).toHaveURL(section.url)
        await page.click('nav a:has-text("Dashboard")')
      }
    })

    test('Admin sees appropriate dashboard content', async ({ page }) => {
      await loginAs(page, 'admin')

      // Check for admin-specific dashboard elements
      await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('text=Inventory Value')).toBeVisible()
      await expect(page.locator('text=Monthly Production')).toBeVisible()
      await expect(page.locator('text=Open POs')).toBeVisible()
      await expect(page.locator('text=Compliance')).toBeVisible()
    })
  })

  test.describe('Brewer Role', () => {
    test('Brewer sees limited navigation items', async ({ page }) => {
      await loginAs(page, 'brewer')

      // Check visible navigation items
      await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Production")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Inventory")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Recipes")')).toBeVisible()

      // Check hidden navigation items
      await expect(page.locator('nav a:has-text("Purchasing")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Compliance")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Settings")')).not.toBeVisible()

      // Check Invite Team button is NOT visible
      await expect(page.locator('a:has-text("Invite Team")')).not.toBeVisible()
    })

    test('Brewer sees appropriate dashboard content', async ({ page }) => {
      await loginAs(page, 'brewer')

      // Check for brewer-specific dashboard elements
      await expect(page.locator('h1:has-text("Brewer Dashboard")')).toBeVisible()
      await expect(page.locator('text=Active Batches')).toBeVisible()
      await expect(page.locator('text=Tank Usage')).toBeVisible()
      await expect(page.locator('text=Upcoming Brews')).toBeVisible()
      await expect(page.locator('text=Readings Due')).toBeVisible()
      await expect(page.locator('text=Today\'s Tasks')).toBeVisible()
    })

    test('Brewer cannot access restricted pages', async ({ page }) => {
      await loginAs(page, 'brewer')

      // Try to navigate directly to restricted pages
      await page.goto('/settings')
      await expect(page).toHaveURL('/dashboard') // Should redirect

      await page.goto('/compliance')
      await expect(page).toHaveURL('/dashboard') // Should redirect
    })
  })

  test.describe('Inventory Role', () => {
    test('Inventory user sees appropriate navigation', async ({ page }) => {
      await loginAs(page, 'inventory')

      // Check visible navigation items
      await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Inventory")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Purchasing")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Reports")')).toBeVisible()

      // Check hidden navigation items
      await expect(page.locator('nav a:has-text("Production")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Recipes")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Compliance")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Settings")')).not.toBeVisible()
    })

    test('Inventory user sees appropriate dashboard content', async ({ page }) => {
      await loginAs(page, 'inventory')

      // Check for inventory-specific dashboard elements
      await expect(page.locator('h1:has-text("Inventory Dashboard")')).toBeVisible()
      await expect(page.locator('text=Low Stock Items')).toBeVisible()
      await expect(page.locator('text=Pending Receiving')).toBeVisible()
      await expect(page.locator('text=Open POs')).toBeVisible()
      await expect(page.locator('text=Cycle Count')).toBeVisible()
    })
  })

  test.describe('Accounting Role', () => {
    test('Accounting user sees appropriate navigation', async ({ page }) => {
      await loginAs(page, 'accounting')

      // Check visible navigation items
      await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Purchasing")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Reports")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Compliance")')).toBeVisible()

      // Check hidden navigation items
      await expect(page.locator('nav a:has-text("Production")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Inventory")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Recipes")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Settings")')).not.toBeVisible()
    })

    test('Accounting user sees financial and compliance content', async ({ page }) => {
      await loginAs(page, 'accounting')

      // Check for accounting-specific dashboard elements
      await expect(page.locator('h1:has-text("Compliance & Accounting")')).toBeVisible()
      await expect(page.locator('text=Inventory Value')).toBeVisible()
      await expect(page.locator('text=Open Invoices')).toBeVisible()
      await expect(page.locator('text=BROP Status')).toBeVisible()
      await expect(page.locator('text=Excise Tax')).toBeVisible()
      await expect(page.locator('text=Compliance Tasks')).toBeVisible()
    })
  })

  test.describe('Contract Viewer Role', () => {
    test('Contract viewer has minimal navigation', async ({ page }) => {
      await loginAs(page, 'contractViewer')

      // Check visible navigation items (very limited)
      await expect(page.locator('nav a:has-text("Dashboard")')).toBeVisible()
      await expect(page.locator('nav a:has-text("Reports")')).toBeVisible()

      // Check all other items are hidden
      await expect(page.locator('nav a:has-text("Production")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Inventory")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Purchasing")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Recipes")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Compliance")')).not.toBeVisible()
      await expect(page.locator('nav a:has-text("Settings")')).not.toBeVisible()
    })

    test('Contract viewer sees limited dashboard content', async ({ page }) => {
      await loginAs(page, 'contractViewer')

      // Check for contract viewer dashboard
      await expect(page.locator('h1:has-text("Contract Overview")')).toBeVisible()
      await expect(page.locator('text=Your Batches')).toBeVisible()
      await expect(page.locator('text=limited access')).toBeVisible()
    })
  })
})

test.describe('Authentication Flow', () => {
  test('User can sign up and create workspace', async ({ page }) => {
    await page.goto('/auth/signup')

    // Fill signup form
    await page.fill('input[name="fullName"]', 'Test User')
    await page.fill('input[name="breweryName"]', 'Test Brewery')
    await page.fill('input[name="email"]', `test${Date.now()}@brewcrush.com`)
    await page.fill('input[name="password"]', 'TestPassword123!')
    await page.fill('input[name="confirmPassword"]', 'TestPassword123!')

    await page.click('button[type="submit"]')

    // Should redirect to onboarding
    await page.waitForURL('/onboarding')

    // Create workspace
    await page.fill('input[name="workspaceName"]', 'Test Brewery')
    await page.click('button:has-text("Create Workspace")')

    // Should redirect to dashboard
    await page.waitForURL('/dashboard')
    await expect(page.locator('text=Test Brewery')).toBeVisible()
  })

  test('User can login and logout', async ({ page }) => {
    await loginAs(page, 'admin')

    // Check user is logged in
    await expect(page.locator('text=admin@brewcrushtest.com')).toBeVisible()

    // Logout
    await page.click('button[aria-label="Sign out"]')
    await page.waitForURL('/')
    await expect(page.locator('text=Welcome to BrewCrush')).toBeVisible()
  })

  test('Protected routes redirect to login', async ({ page }) => {
    // Try to access dashboard without login
    await page.goto('/dashboard')
    await expect(page).toHaveURL('/auth/login')

    // Try other protected routes
    await page.goto('/production')
    await expect(page).toHaveURL('/auth/login')

    await page.goto('/inventory')
    await expect(page).toHaveURL('/auth/login')
  })
})

test.describe('Invite System', () => {
  test('Admin can invite new users', async ({ page }) => {
    await loginAs(page, 'admin')

    // Navigate to team settings
    await page.click('a:has-text("Invite Team")')
    await page.waitForURL('/settings/team')

    // Fill invite form
    await page.fill('input[name="email"]', 'newuser@brewcrush.com')
    await page.selectOption('select[name="role"]', 'brewer')
    await page.click('button:has-text("Send Invite")')

    // Check success message
    await expect(page.locator('text=Invite sent successfully')).toBeVisible()
  })

  test('Non-admin cannot access invite page', async ({ page }) => {
    await loginAs(page, 'brewer')

    // Try to navigate directly to team settings
    await page.goto('/settings/team')
    await expect(page).toHaveURL('/dashboard') // Should redirect
  })
})

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('Mobile menu works correctly', async ({ page }) => {
    await loginAs(page, 'admin')

    // Initially, sidebar should be hidden on mobile
    await expect(page.locator('nav')).not.toBeInViewport()

    // Click hamburger menu
    await page.click('button[aria-label="Open menu"]')

    // Sidebar should be visible
    await expect(page.locator('nav')).toBeVisible()

    // Click a navigation item
    await page.click('nav a:has-text("Production")')
    
    // Sidebar should close after navigation
    await expect(page.locator('nav')).not.toBeInViewport()
    await expect(page).toHaveURL('/production')
  })

  test('Mobile dashboard is responsive', async ({ page }) => {
    await loginAs(page, 'admin')

    // Check that dashboard adapts to mobile
    await expect(page.locator('.grid')).toHaveCSS('grid-template-columns', /1fr/)
  })
})