describe('Settings page', () => {
  beforeEach(() => {
    cy.login()
  })

  it('loads the settings page', () => {
    cy.visit('/settings')
    cy.contains('Settings').should('be.visible')
    cy.contains('Network access').should('be.visible')
  })

  it('displays network information', () => {
    cy.visit('/settings')
    // The settings page fetches /api/settings/network and shows IP addresses
    cy.contains('Network', { timeout: 5000 }).should('be.visible')
  })
})
