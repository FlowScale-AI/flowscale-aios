describe('Users management page', () => {
  beforeEach(() => {
    cy.login()
  })

  it('loads the users page with header and tabs', () => {
    cy.visit('/users')
    cy.contains('Users').should('be.visible')
    cy.contains('Manage team members').should('be.visible')
    cy.contains('All Users').should('be.visible')
    cy.contains('Pending Approval').should('be.visible')
    cy.contains('Add User').should('be.visible')
  })

  it('shows the admin user in the active tab', () => {
    cy.visit('/users')
    // The user list content area (not sidebar) should show admin
    cy.get('main').contains('admin').should('be.visible')
    cy.get('main').contains('active').should('be.visible')
  })

  it('opens the Add User modal', () => {
    cy.visit('/users')
    cy.contains('Add User').click()
    // Modal should appear
    cy.get('form').should('be.visible')
    cy.contains('Username').should('be.visible')
    cy.contains('Password').should('be.visible')
    cy.contains('Role').should('be.visible')
    cy.contains('Create').should('be.visible')
    cy.contains('Cancel').should('be.visible')
  })

  it('creates a user via the modal', () => {
    const username = `cypress_user_${Date.now()}`
    cy.visit('/users')
    cy.contains('Add User').click()

    cy.get('form').within(() => {
      cy.get('input').first().type(username)
      cy.get('input[type="password"]').type('securepass123')
      cy.contains('Create').click()
    })

    // Should appear in the user list after creation
    cy.contains(username, { timeout: 5000 }).should('be.visible')

    // Clean up: delete the user via API
    cy.request('/api/users').then((res) => {
      const user = res.body.find((u: any) => u.username === username)
      if (user) cy.request('DELETE', `/api/users/${user.id}`)
    })
  })

  it('switches to pending tab', () => {
    // Clean up any leftover pending users from previous test runs
    cy.request('/api/users').then((res) => {
      for (const u of res.body.filter((u: any) => u.status === 'pending')) {
        cy.request('DELETE', `/api/users/${u.id}`)
      }
    })

    cy.visit('/users')
    cy.contains('Pending Approval').click()
    cy.contains('No pending requests').should('be.visible')
  })

  it('shows pending users after registration', () => {
    const username = `pending_${Date.now()}`

    // Register a user (creates in pending state)
    cy.request({
      method: 'POST',
      url: '/api/auth/register',
      body: { username, password: 'securepass123', role: 'artist' },
    })

    cy.visit('/users')
    cy.contains('Pending Approval').click()
    cy.contains(username).should('be.visible')
    cy.contains('Approve').should('be.visible')

    // Clean up
    cy.request('/api/users').then((res) => {
      const user = res.body.find((u: any) => u.username === username)
      if (user) cy.request('DELETE', `/api/users/${user.id}`)
    })
  })
})
