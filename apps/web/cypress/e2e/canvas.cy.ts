describe('Canvas management', () => {
  beforeEach(() => {
    cy.login()
  })

  it('shows the canvas list page', () => {
    cy.visit('/canvas')
    cy.contains('Canvas').should('be.visible')
    cy.contains('New Canvas').should('be.visible')
  })

  it('shows empty state when no canvases exist', () => {
    // Delete all canvases first
    cy.request('/api/canvases').then((res) => {
      for (const canvas of res.body) {
        cy.request('DELETE', `/api/canvases/${canvas._id}`)
      }
    })
    cy.visit('/canvas')
    cy.contains('No canvases yet').should('be.visible')
    cy.contains('Create Canvas').should('be.visible')
  })

  it('creates a new canvas via API and displays it in the list', () => {
    cy.request({
      method: 'POST',
      url: '/api/canvases',
      body: { name: `E2E Canvas ${Date.now()}`, description: 'Created by Cypress' },
    }).then((res) => {
      expect(res.status).to.eq(201)
      const canvasId = res.body._id

      cy.visit('/canvas')
      cy.contains('E2E Canvas').should('be.visible')

      // Clean up
      cy.request('DELETE', `/api/canvases/${canvasId}`)
    })
  })

  it('opens the create canvas modal when clicking New Canvas', () => {
    cy.visit('/canvas')
    cy.contains('New Canvas').first().click()
    // Modal should appear with a form
    cy.get('input').should('be.visible')
  })

  it('navigates to canvas detail page on click', () => {
    // Create a canvas
    cy.request({
      method: 'POST',
      url: '/api/canvases',
      body: { name: 'Clickable Canvas' },
    }).then((res) => {
      const canvasId = res.body._id

      cy.visit('/canvas')
      cy.contains('Clickable Canvas').click()
      cy.url().should('include', `/canvas/${canvasId}`)

      // Clean up
      cy.request('DELETE', `/api/canvases/${canvasId}`)
    })
  })
})

describe('Canvas detail page', () => {
  let canvasId: string

  before(() => {
    cy.login()
    cy.request({
      method: 'POST',
      url: '/api/canvases',
      body: { name: 'Detail Canvas', description: 'For detail tests' },
    }).then((res) => {
      canvasId = res.body._id
    })
  })

  after(() => {
    cy.login()
    cy.request('DELETE', `/api/canvases/${canvasId}`)
  })

  beforeEach(() => {
    cy.login()
  })

  it('loads the canvas surface', () => {
    cy.visit(`/canvas/${canvasId}`)
    // The canvas surface should render (zoom controls are always present)
    cy.get('button').should('have.length.greaterThan', 0)
  })

  it('shows zoom controls', () => {
    cy.visit(`/canvas/${canvasId}`)
    // Zoom percentage indicator
    cy.contains('100%').should('be.visible')
  })
})
