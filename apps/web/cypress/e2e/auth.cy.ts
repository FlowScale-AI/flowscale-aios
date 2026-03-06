describe('Authentication', () => {
  beforeEach(() => {
    cy.clearCookies()
  })

  it('redirects unauthenticated users to /login', () => {
    cy.visit('/apps')
    cy.url().should('include', '/login')
  })

  it('shows the login form with branding', () => {
    cy.visit('/login')
    cy.contains('Sign in').should('be.visible')
    cy.contains('FlowScale').should('be.visible')
    cy.get('input[placeholder="Enter your username"]').should('be.visible')
    cy.get('input[placeholder="Enter your password"]').should('be.visible')
    cy.get('button[type="submit"]').should('contain.text', 'Sign in')
  })

  it('shows a link to the registration page', () => {
    cy.visit('/login')
    cy.contains('Request an account').should('have.attr', 'href', '/register')
  })

  it('displays an error for invalid credentials', () => {
    cy.visit('/login')
    cy.get('input[placeholder="Enter your username"]').type('admin')
    cy.get('input[placeholder="Enter your password"]').type('wrongpassword')
    cy.get('button[type="submit"]').click()
    cy.contains('Invalid username or password').should('be.visible')
  })

  it('logs in successfully and redirects to /apps', () => {
    cy.login()
    cy.visit('/apps')
    cy.url().should('include', '/apps')
    cy.contains('Apps').should('be.visible')
  })

  it('logs out and redirects to /login', () => {
    cy.login()
    cy.request('POST', '/api/auth/logout')
    cy.visit('/apps')
    cy.url().should('include', '/login')
  })
})

describe('Registration', () => {
  beforeEach(() => {
    cy.clearCookies()
  })

  it('shows the registration form', () => {
    cy.visit('/register')
    cy.contains('Request access').should('be.visible')
    cy.get('input[placeholder="Choose a username"]').should('be.visible')
    cy.get('input[placeholder="At least 8 characters"]').should('be.visible')
    cy.get('input[placeholder="Repeat password"]').should('be.visible')
    cy.contains('Artist').should('be.visible')
    cy.contains('Dev').should('be.visible')
  })

  it('shows password mismatch error', () => {
    cy.visit('/register')
    cy.get('input[placeholder="Choose a username"]').type('testuser')
    cy.get('input[placeholder="At least 8 characters"]').type('password123')
    cy.get('input[placeholder="Repeat password"]').type('different123')
    cy.get('button[type="submit"]').click()
    cy.contains('Passwords do not match').should('be.visible')
  })

  it('submits registration and shows pending message', () => {
    const username = `testuser_${Date.now()}`
    cy.visit('/register')
    cy.get('input[placeholder="Choose a username"]').type(username)
    cy.get('input[placeholder="At least 8 characters"]').type('securepassword')
    cy.get('input[placeholder="Repeat password"]').type('securepassword')
    cy.get('button[type="submit"]').click()
    cy.contains('Request submitted').should('be.visible')
    cy.contains('pending approval').should('be.visible')
    cy.contains('Back to sign in').should('have.attr', 'href', '/login')
  })

  it('shows a link back to login', () => {
    cy.visit('/register')
    cy.contains('Sign in').should('have.attr', 'href', '/login')
  })
})
