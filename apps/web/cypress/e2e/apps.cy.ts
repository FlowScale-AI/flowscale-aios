describe('Apps page', () => {
  beforeEach(() => {
    cy.login()
  })

  it('loads the apps page with sidebar navigation', () => {
    cy.visit('/apps')
    cy.url().should('include', '/apps')
    // Page header
    cy.contains('Apps').should('be.visible')
    // Canvas card should be visible (always present)
    cy.contains('Canvas').should('be.visible')
  })

  it('sidebar shows navigation links based on admin role', () => {
    cy.visit('/apps')
    // Admin should see all nav items — sidebar nav exists
    cy.get('nav').should('exist')
    // Sidebar contains the admin username (may be hidden until hover)
    cy.contains('admin').should('exist')
  })

  it('navigates to canvas list from the apps page', () => {
    cy.visit('/apps')
    cy.contains('Canvas').click()
    cy.url().should('include', '/canvas')
  })
})
