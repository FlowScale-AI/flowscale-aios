describe('API routes', () => {
  beforeEach(() => {
    cy.login()
  })

  // ── Auth API ─────────────────────────────────────────────────────────

  describe('Auth API', () => {
    it('GET /api/auth/me returns current user', () => {
      cy.request('/api/auth/me').then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.username).to.eq('admin')
        expect(res.body.role).to.eq('admin')
        expect(res.body).not.to.have.property('passwordHash')
      })
    })

    it('GET /api/auth/me returns 401 without session', () => {
      cy.clearCookies()
      cy.request({ url: '/api/auth/me', failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(401)
      })
    })

    it('POST /api/auth/login returns 401 for bad credentials', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: { username: 'admin', password: 'wrong' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(401)
      })
    })

    it('POST /api/auth/register rejects admin role', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/register',
        body: { username: 'hacker', password: 'securepass', role: 'admin' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.error).to.include('Invalid role')
      })
    })
  })

  // ── Tools API ────────────────────────────────────────────────────────

  describe('Tools API', () => {
    const toolPayload = {
      name: 'Cypress Tool',
      description: 'Created by Cypress',
      workflowJson: JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }),
      workflowHash: 'cy-hash',
      schemaJson: JSON.stringify([]),
      layout: 'left-right',
      comfyPort: 8188,
    }

    it('CRUD lifecycle: create, list, get, update, delete', () => {
      // Create
      cy.request({ method: 'POST', url: '/api/tools', body: toolPayload }).then((res) => {
        expect(res.status).to.eq(201)
        const id = res.body.id
        expect(res.body.name).to.eq('Cypress Tool')
        expect(res.body.status).to.eq('dev')

        // List
        cy.request('/api/tools').then((listRes) => {
          expect(listRes.body.some((t: any) => t.id === id)).to.be.true
        })

        // Get
        cy.request(`/api/tools/${id}`).then((getRes) => {
          expect(getRes.body.id).to.eq(id)
        })

        // Update
        cy.request({
          method: 'PATCH',
          url: `/api/tools/${id}`,
          body: { name: 'Updated Cypress Tool' },
        }).then((patchRes) => {
          expect(patchRes.body.name).to.eq('Updated Cypress Tool')
        })

        // Delete
        cy.request({ method: 'DELETE', url: `/api/tools/${id}` }).then((delRes) => {
          expect(delRes.status).to.eq(204)
        })

        // Verify gone
        cy.request({ url: `/api/tools/${id}`, failOnStatusCode: false }).then((r) => {
          expect(r.status).to.eq(404)
        })
      })
    })

    it('GET /api/tools?status=production filters by status', () => {
      cy.request('/api/tools?status=production').then((res) => {
        expect(res.status).to.eq(200)
        expect(Array.isArray(res.body)).to.be.true
      })
    })
  })

  // ── Canvases API ─────────────────────────────────────────────────────

  describe('Canvases API', () => {
    it('CRUD lifecycle: create, list, get, patch, delete', () => {
      cy.request({
        method: 'POST',
        url: '/api/canvases',
        body: { name: 'API Canvas', description: 'test' },
      }).then((res) => {
        expect(res.status).to.eq(201)
        const id = res.body._id
        expect(res.body.name).to.eq('API Canvas')
        expect(res.body.is_shared).to.eq(false)

        // List
        cy.request('/api/canvases').then((listRes) => {
          expect(listRes.body.some((c: any) => c._id === id)).to.be.true
        })

        // Get
        cy.request(`/api/canvases/${id}`).then((getRes) => {
          expect(getRes.body._id).to.eq(id)
        })

        // Patch (toggle share)
        cy.request({
          method: 'PATCH',
          url: `/api/canvases/${id}`,
          body: { is_shared: true },
        }).then((patchRes) => {
          expect(patchRes.body.is_shared).to.eq(true)
        })

        // Delete
        cy.request({ method: 'DELETE', url: `/api/canvases/${id}` }).then((delRes) => {
          expect(delRes.status).to.eq(204)
        })
      })
    })

    it('canvas items CRUD: upsert, get, replace, delete', () => {
      cy.request({
        method: 'POST',
        url: '/api/canvases',
        body: { name: 'Items Canvas' },
      }).then((res) => {
        const id = res.body._id

        const item = {
          _id: 'cy-item-1',
          type: 'image',
          position: { x: 10, y: 20, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
          z_index: 1,
          locked: false,
          hidden: false,
          data: { label: 'Cypress item' },
        }

        // Upsert item
        cy.request({
          method: 'POST',
          url: `/api/canvases/${id}/items`,
          body: { items: [item] },
        }).then((r) => expect(r.status).to.eq(204))

        // Get items
        cy.request(`/api/canvases/${id}/items`).then((r) => {
          expect(r.body.length).to.eq(1)
          expect(r.body[0]._id).to.eq('cy-item-1')
        })

        // Replace items
        cy.request({
          method: 'PATCH',
          url: `/api/canvases/${id}/items`,
          body: { items: [{ ...item, _id: 'cy-item-2' }] },
        }).then((r) => expect(r.status).to.eq(204))

        cy.request(`/api/canvases/${id}/items`).then((r) => {
          expect(r.body.length).to.eq(1)
          expect(r.body[0]._id).to.eq('cy-item-2')
        })

        // Delete single item
        cy.request({
          method: 'DELETE',
          url: `/api/canvases/${id}/items/cy-item-2`,
        }).then((r) => expect(r.status).to.eq(204))

        cy.request(`/api/canvases/${id}/items`).then((r) => {
          expect(r.body.length).to.eq(0)
        })

        // Clean up
        cy.request('DELETE', `/api/canvases/${id}`)
      })
    })
  })

  // ── Users API ────────────────────────────────────────────────────────

  describe('Users API', () => {
    it('GET /api/users lists users (admin only)', () => {
      cy.request('/api/users').then((res) => {
        expect(res.status).to.eq(200)
        expect(Array.isArray(res.body)).to.be.true
        expect(res.body[0]).not.to.have.property('passwordHash')
      })
    })

    it('POST /api/users creates and DELETE removes a user', () => {
      cy.request({
        method: 'POST',
        url: '/api/users',
        body: { username: `cy_del_${Date.now()}`, password: 'securepass', role: 'artist' },
      }).then((res) => {
        expect(res.status).to.eq(201)
        const id = res.body.id

        cy.request({ method: 'DELETE', url: `/api/users/${id}` }).then((delRes) => {
          expect(delRes.status).to.eq(200)
        })
      })
    })

    it('rejects unauthenticated access to user list', () => {
      cy.clearCookies()
      cy.request({
        url: '/api/users',
        failOnStatusCode: false,
        followRedirect: false,
      }).then((res) => {
        // Middleware redirects unauthenticated requests to /login
        expect([302, 307, 403]).to.include(res.status)
      })
    })
  })

  // ── Tool Configs API ─────────────────────────────────────────────────

  describe('Tool Configs API', () => {
    const workflowId = `cy-wf-${Date.now()}`

    it('GET returns 204 when no config exists', () => {
      cy.request({ url: `/api/tool-configs/${workflowId}`, failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(204)
      })
    })

    it('PUT creates config and GET retrieves it', () => {
      const config = { inputs: { '1__text': { visible: true, label: 'Prompt' } } }

      cy.request({
        method: 'PUT',
        url: `/api/tool-configs/${workflowId}`,
        body: config,
      }).then((res) => expect(res.status).to.eq(204))

      cy.request(`/api/tool-configs/${workflowId}`).then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.inputs['1__text'].label).to.eq('Prompt')
      })
    })
  })

  // ── Workflow Analyze API ─────────────────────────────────────────────

  describe('Workflow Analyze API', () => {
    it('analyzes a valid API-format workflow', () => {
      const workflow = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['2', 0] } },
        '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
        '3': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
      }

      cy.request({
        method: 'POST',
        url: '/api/workflow/analyze',
        body: { workflowJson: JSON.stringify(workflow) },
      }).then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.hash).to.have.length(64)
        expect(Array.isArray(res.body.schema)).to.be.true
      })
    })

    it('returns 400 for missing workflowJson', () => {
      cy.request({
        method: 'POST',
        url: '/api/workflow/analyze',
        body: {},
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(400)
      })
    })
  })

  // ── Runs API ─────────────────────────────────────────────────────────

  describe('Runs API', () => {
    it('GET /api/runs returns paginated response', () => {
      cy.request('/api/runs').then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.status).to.eq('success')
        expect(Array.isArray(res.body.data)).to.be.true
        expect(res.body).to.have.property('total')
        expect(res.body).to.have.property('total_pages')
      })
    })
  })
})
