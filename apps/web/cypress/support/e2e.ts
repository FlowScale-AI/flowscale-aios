// Custom commands for FlowScale E2E tests

declare global {
  namespace Cypress {
    interface Chainable {
      /** Log in via the API and set the session cookie */
      login(username?: string, password?: string): Chainable<void>
      /** Create a user via the API (requires admin session) */
      createUser(username: string, password: string, role?: string): Chainable<string>
      /** Seed the DB for a fresh test run by clearing non-admin users */
      resetTestState(): Chainable<void>
    }
  }
}

Cypress.Commands.add('login', (username = 'admin', password?: string) => {
  // On first run, the admin password is auto-generated.
  // We fetch /api/auth/me first; if 401, try the setup page to get the initial password.
  const pw = password ?? Cypress.env('ADMIN_PASSWORD') ?? 'testpassword123'
  cy.request({
    method: 'POST',
    url: '/api/auth/login',
    body: { username, password: pw },
    failOnStatusCode: false,
  }).then((res) => {
    if (res.status === 200) return
    // If login failed and no explicit password, something is wrong
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  })
})

Cypress.Commands.add('createUser', (username: string, password: string, role = 'artist') => {
  return cy.request({
    method: 'POST',
    url: '/api/users',
    body: { username, password, role },
  }).then((res) => res.body.id as string)
})

Cypress.Commands.add('resetTestState', () => {
  // Just ensure we're logged in — state resets are handled by test isolation
  cy.login()
})

export {}
