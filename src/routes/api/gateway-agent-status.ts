/**
 * Gateway Agent Status API — returns configured vs live info for an agent's Hermes gateway.
 * GET /api/gateway-agent-status?agentName=<name>
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { isAuthenticated } from '../../server/auth-middleware'
import { getConfiguredInfo, getLiveInfo } from '../../server/gateway-utils'

const PROFILES_DIR = '/home/mako/.hermes/profiles'

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
          // Check 1: config.yaml content differs from what the gateway started with.
          // Compares current config hash against .last-started-config-hash written by hermes-gateway-start.sh.
          // This catches any config change (model, context_length, etc.) that hasn't been picked up yet.
          if (configured.startedHash) {
            const content = fs.readFileSync(`${PROFILES_DIR}/${agentName}/config.yaml`, 'utf8')
            const currentHash = crypto.createHash('sha256').update(content).digest('hex')
            if (currentHash !== configured.startedHash) {
              hasMismatch = true
            }
          }
          // Check 2: incomplete config (fallback for edge cases)
          else if (!configured.baseUrl || !configured.model) {
            hasMismatch = true
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
