/**
 * Gateway Control API — start, stop, or restart an agent's Hermes gateway.
 * POST /api/gateway-control  { agentName, action }
 */
import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { executeControlAction } from '../../server/gateway-utils'

const VALID_ACTIONS = new Set(['start', 'stop', 'restart'])

export const Route = createFileRoute('/api/gateway-control')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        let body: any
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const agentName = (body.agentName || '').trim().toLowerCase()
        if (!agentName) {
          return json({ ok: false, error: 'agentName is required' }, { status: 400 })
        }

        const action = (body.action || '').trim().toLowerCase()
        if (!VALID_ACTIONS.has(action)) {
          return json(
            { ok: false, error: `action must be one of: ${Array.from(VALID_ACTIONS).join(', ')}` },
            { status: 400 },
          )
        }

        // Verify agent profile exists
        const configPath = `/home/mako/.hermes/profiles/${agentName}/config.yaml`
        if (!fs.existsSync(configPath)) {
          return json(
            { ok: false, error: `Agent '${agentName}' not found — no config at ${configPath}` },
            { status: 404 },
          )
        }

        // Execute the control action
        const result = await executeControlAction(agentName, action as 'start' | 'stop' | 'restart')

        if (!result.ok) {
          return json(
            { ok: false, error: result.error || 'Operation failed', message: result.message },
            { status: 500 },
          )
        }

        return json({
          ok: true,
          agentName,
          action,
          message: result.message,
          serviceStatus: result.serviceStatus,
        })
      },
    },
  },
})
