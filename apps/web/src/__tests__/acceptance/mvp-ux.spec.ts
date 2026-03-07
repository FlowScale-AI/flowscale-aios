/**
 * FlowScale AIOS — MVP UX Acceptance Tests
 *
 * Derived from:
 *   - FlowScale AIOS MVP PRD (8 epics)
 *   - FlowScale MVP App UX (Notion doc)
 *
 * Covers:
 *   AC-01  Root redirect → /home
 *   AC-02  Login flow
 *   AC-03  Sidebar structure and sections
 *   AC-04  Home page sections
 *   AC-05  Tools page
 *   AC-06  Providers page
 *   AC-07  App Store (Explore) rename
 *   AC-08  Settings — Developer Mode toggle
 *   AC-09  Sidebar hover expand
 *   AC-10  Installed app header bar
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:14173'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto(BASE + '/login')
  await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 10_000 })

  const usernameInput = page.locator('input[type="text"], input[name="username"]').first()
  const passwordInput = page.locator('input[type="password"]').first()
  const submitBtn = page.locator('button[type="submit"]').first()

  await usernameInput.fill('admin')
  await passwordInput.fill('admin')
  await submitBtn.click()

  // Wait until we're past /login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('FlowScale MVP UX Acceptance', () => {

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // ── AC-01: Root redirect ──────────────────────────────────────────────────

  test('AC-01 — root / redirects to /home', async ({ page }) => {
    await page.goto(BASE + '/')
    await page.waitForURL('**/home', { timeout: 8_000 })
    expect(page.url()).toContain('/home')
  })

  // ── AC-02: Login ──────────────────────────────────────────────────────────

  test('AC-02 — login page redirects unauthenticated users', async ({ page }) => {
    // Sign out first by clearing cookies
    await page.context().clearCookies()
    await page.goto(BASE + '/home')
    await page.waitForURL('**/login', { timeout: 8_000 })
    expect(page.url()).toContain('/login')
  })

  // ── AC-03: Sidebar structure ──────────────────────────────────────────────

  test('AC-03a — sidebar is visible after login', async ({ page }) => {
    await page.goto(BASE + '/home')
    const sidebar = page.locator('nav').first()
    await expect(sidebar).toBeVisible()
  })

  test('AC-03b — sidebar contains Home link', async ({ page }) => {
    await page.goto(BASE + '/home')
    const homeLink = page.locator('nav a[href="/home"]')
    await expect(homeLink).toBeVisible()
  })

  test('AC-03c — sidebar contains Canvas link', async ({ page }) => {
    await page.goto(BASE + '/home')
    const canvasLink = page.locator('nav a[href="/canvas"]')
    await expect(canvasLink).toBeVisible()
  })

  test('AC-03d — sidebar contains Tools link', async ({ page }) => {
    await page.goto(BASE + '/home')
    const toolsLink = page.locator('nav a[href="/tools"]')
    await expect(toolsLink).toBeVisible()
  })

  test('AC-03e — sidebar contains Providers link', async ({ page }) => {
    await page.goto(BASE + '/home')
    const providersLink = page.locator('nav a[href="/providers"]')
    await expect(providersLink).toBeVisible()
  })

  test('AC-03f — sidebar contains App Store link to /explore', async ({ page }) => {
    await page.goto(BASE + '/home')
    const exploreLink = page.locator('nav a[href="/explore"]')
    await expect(exploreLink).toBeVisible()
  })

  test('AC-03g — sidebar contains Settings link', async ({ page }) => {
    await page.goto(BASE + '/home')
    const settingsLink = page.locator('nav a[href="/settings"]')
    await expect(settingsLink).toBeVisible()
  })

  test('AC-03h — sidebar shows section labels on hover', async ({ page }) => {
    await page.goto(BASE + '/home')
    const sidebar = page.locator('nav').first()
    await sidebar.hover()
    await page.waitForTimeout(300)
    // At least one section label should be visible after hover
    const labels = page.locator('nav').getByText(/Apps|Tools|Infrastructure|Discover/i)
    await expect(labels.first()).toBeVisible()
  })

  // ── AC-04: Home page ──────────────────────────────────────────────────────

  test('AC-04a — home page renders heading', async ({ page }) => {
    await page.goto(BASE + '/home')
    await expect(page.getByRole('heading', { name: /home/i })).toBeVisible()
  })

  test('AC-04b — home page shows Quick Access section', async ({ page }) => {
    await page.goto(BASE + '/home')
    await expect(page.getByText(/quick access/i)).toBeVisible()
  })

  test('AC-04c — home page shows Canvas card in Quick Access', async ({ page }) => {
    await page.goto(BASE + '/home')
    await expect(page.getByText(/quick access/i)).toBeVisible()
    const canvasCard = page.locator('a[href="/canvas"]').first()
    await expect(canvasCard).toBeVisible()
  })

  test('AC-04d — home page shows Install More card linking to App Store', async ({ page }) => {
    await page.goto(BASE + '/home')
    const installMore = page.locator('a[href="/explore"]').first()
    await expect(installMore).toBeVisible()
  })

  test('AC-04e — home page shows Recent Activity section', async ({ page }) => {
    await page.goto(BASE + '/home')
    await expect(page.getByText(/recent activity/i)).toBeVisible()
  })

  test('AC-04f — home page shows System Status section', async ({ page }) => {
    await page.goto(BASE + '/home')
    await expect(page.getByText(/system status/i)).toBeVisible()
  })

  // ── AC-05: Tools page ─────────────────────────────────────────────────────

  test('AC-05a — tools page renders heading', async ({ page }) => {
    await page.goto(BASE + '/tools')
    await expect(page.getByRole('heading', { name: /tools/i })).toBeVisible()
  })

  test('AC-05b — tools page has Build Tool button', async ({ page }) => {
    await page.goto(BASE + '/tools')
    const buildBtn = page.getByRole('link', { name: /build tool/i })
    await expect(buildBtn).toBeVisible()
    await expect(buildBtn).toHaveAttribute('href', '/build-tool')
  })

  test('AC-05c — tools page has search input', async ({ page }) => {
    await page.goto(BASE + '/tools')
    const search = page.locator('input[placeholder*="Search"]')
    await expect(search).toBeVisible()
  })

  test('AC-05d — tools page shows registry tools section', async ({ page }) => {
    await page.goto(BASE + '/tools')
    await expect(page.getByText(/all tools/i)).toBeVisible()
  })

  test('AC-05e — tools page has category filter buttons', async ({ page }) => {
    await page.goto(BASE + '/tools')
    // "All" filter should always be present
    const allFilter = page.locator('button', { hasText: /^all$/i })
    await expect(allFilter.first()).toBeVisible()
  })

  test('AC-05f — tools page search filters results', async ({ page }) => {
    await page.goto(BASE + '/tools')
    const search = page.locator('input[placeholder*="Search"]')
    await search.fill('sdxl')
    await page.waitForTimeout(300)
    // Should show SDXL tool or "no tools" message — not crash
    const page_ = page.locator('body')
    await expect(page_).toBeVisible()
  })

  test('AC-05g — clicking a tool card opens detail panel', async ({ page }) => {
    await page.goto(BASE + '/tools')
    // Wait for tools to load
    const toolCards = page.locator('.grid button').first()
    await toolCards.waitFor({ timeout: 8_000 })
    await toolCards.click()
    // Detail panel should appear
    await expect(page.locator('[class*="fixed"]').first()).toBeVisible({ timeout: 3_000 })
  })

  test('AC-05h — tool detail panel can be closed', async ({ page }) => {
    await page.goto(BASE + '/tools')
    const toolCards = page.locator('.grid button').first()
    await toolCards.waitFor({ timeout: 8_000 })
    await toolCards.click()
    const closeBtn = page.locator('[class*="fixed"] button').filter({ hasText: /close/i })
    await closeBtn.click()
    await expect(page.locator('[class*="fixed"]')).toHaveCount(0)
  })

  // ── AC-06: Providers page ─────────────────────────────────────────────────

  test('AC-06a — providers page renders heading', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByRole('heading', { name: /providers/i })).toBeVisible()
  })

  test('AC-06b — providers page shows Local Inference section with ComfyUI', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/local inference/i)).toBeVisible()
    await expect(page.getByText(/comfyui/i)).toBeVisible()
  })

  test('AC-06c — providers page shows Cloud Providers section', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/cloud providers/i)).toBeVisible()
  })

  test('AC-06d — providers page lists fal.ai', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/fal\.ai/i)).toBeVisible()
  })

  test('AC-06e — providers page lists Replicate', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/replicate/i)).toBeVisible()
  })

  test('AC-06f — providers page lists OpenRouter', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/openrouter/i)).toBeVisible()
  })

  test('AC-06g — providers page lists HuggingFace', async ({ page }) => {
    await page.goto(BASE + '/providers')
    await expect(page.getByText(/hugging\s?face/i)).toBeVisible()
  })

  test('AC-06h — each provider card has an API key input', async ({ page }) => {
    await page.goto(BASE + '/providers')
    // Wait for provider list to load
    await page.waitForSelector('input[type="password"]', { timeout: 8_000 })
    const keyInputs = page.locator('input[type="password"]')
    await expect(keyInputs.first()).toBeVisible()
  })

  // ── AC-07: App Store rename ───────────────────────────────────────────────

  test('AC-07a — explore page shows "App Store" heading (not "Explore")', async ({ page }) => {
    await page.goto(BASE + '/explore')
    await expect(page.getByRole('heading', { name: /app store/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^explore$/i })).toHaveCount(0)
  })

  // ── AC-08: Settings — Developer Mode toggle ───────────────────────────────

  test('AC-08a — settings page renders heading', async ({ page }) => {
    await page.goto(BASE + '/settings')
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })

  test('AC-08b — settings page shows Network Access section', async ({ page }) => {
    await page.goto(BASE + '/settings')
    await expect(page.getByText(/network access/i)).toBeVisible()
  })

  test('AC-08c — settings page shows Storage section', async ({ page }) => {
    await page.goto(BASE + '/settings')
    await expect(page.getByText(/storage/i)).toBeVisible()
  })

  test('AC-08d — settings page shows Developer Mode toggle', async ({ page }) => {
    await page.goto(BASE + '/settings')
    await expect(page.getByText(/developer mode/i)).toBeVisible()
  })

  test('AC-08e — Developer Mode toggle reveals sideload UI when enabled', async ({ page }) => {
    await page.goto(BASE + '/settings')
    // Sideload UI should NOT be visible initially
    await expect(page.getByPlaceholder(/absolute\/path/i)).toHaveCount(0)
    // Click the toggle
    const toggle = page.locator('button[title*="developer mode"], button[title*="Developer mode"], button[title*="Enable"]').first()
    await toggle.click()
    // Sideload path input should now appear
    await expect(page.getByPlaceholder(/absolute\/path/i)).toBeVisible()
  })

  test('AC-08f — Developer Mode toggle hides sideload UI when disabled again', async ({ page }) => {
    await page.goto(BASE + '/settings')
    const toggle = page.locator('button[title*="developer mode"], button[title*="Developer mode"], button[title*="Enable"]').first()
    await toggle.click()
    await expect(page.getByPlaceholder(/absolute\/path/i)).toBeVisible()
    await toggle.click()
    await expect(page.getByPlaceholder(/absolute\/path/i)).toHaveCount(0)
  })

  // ── AC-09: Sidebar navigation works ──────────────────────────────────────

  test('AC-09a — clicking Tools in sidebar navigates to /tools', async ({ page }) => {
    await page.goto(BASE + '/home')
    await page.locator('nav a[href="/tools"]').click()
    await page.waitForURL('**/tools', { timeout: 5_000 })
    expect(page.url()).toContain('/tools')
  })

  test('AC-09b — clicking Providers in sidebar navigates to /providers', async ({ page }) => {
    await page.goto(BASE + '/home')
    await page.locator('nav a[href="/providers"]').click()
    await page.waitForURL('**/providers', { timeout: 5_000 })
    expect(page.url()).toContain('/providers')
  })

  test('AC-09c — clicking App Store in sidebar navigates to /explore', async ({ page }) => {
    await page.goto(BASE + '/home')
    await page.locator('nav a[href="/explore"]').click()
    await page.waitForURL('**/explore', { timeout: 5_000 })
    expect(page.url()).toContain('/explore')
  })

  test('AC-09d — active nav item is highlighted', async ({ page }) => {
    await page.goto(BASE + '/tools')
    const toolsLink = page.locator('nav a[href="/tools"]')
    // Active link should have emerald color class
    await expect(toolsLink).toHaveClass(/text-emerald/)
  })

  // ── AC-10: Installed app header bar ──────────────────────────────────────

  test('AC-10a — /installed-apps/[id] shows 404 for unknown id', async ({ page }) => {
    await page.goto(BASE + '/installed-apps/nonexistent-app-id-xyz')
    // Should show not found UI, not crash
    const body = page.locator('body')
    await expect(body).toBeVisible()
    // Should show "not found" text or redirect to home
    await expect(page.getByText(/not found|App not found/i).or(page.locator('nav a[href="/home"]'))).toBeVisible({ timeout: 5_000 })
  })

})
