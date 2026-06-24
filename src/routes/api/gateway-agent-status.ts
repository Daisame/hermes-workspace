/**
 * Gateway Agent Status API — returns configured vs live info for an agent's Hermes gateway.
 * GET /api/gateway-agent-status?agentName=<name>
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getConfiguredInfo, getLiveInfo } from '../../server/gateway-utils'

export const Route = createFileRoute('/api/gateway-agent-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const agentName = (url.searchParams.get('agentName') || '').trim().toLowerCase()

        if (!agentName) {
          return json({ ok: false, error: 'agentName query parameter is required' }, { status: 400 })
        }

        // Fetch configured and live info in parallel
        const [configured, live] = await Promise.all([
          getConfiguredInfo(agentName),
          getLiveInfo(agentName),
        ])

        // Determine if there's a mismatch between configured and live values
        let hasMismatch = false
        if (configured && live) {
          // If service is active but config says one model and health shows different routing, flag it
          // We can't easily compare base_url from health endpoint, so check availability
          if (!configured.baseUrl || !configured.model) {
            hasMismatch = true // incomplete config
          }
        }

        return json({
          ok: true,
          agentName,
          configured,
          live,
          hasMismatch,
        })
      },
    },
  },
})
