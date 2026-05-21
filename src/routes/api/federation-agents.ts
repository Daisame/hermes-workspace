/**
 * Federation agents proxy — fetches live status from each Hermes Agent
 * gateway in the federation (port 8641-8645) and returns a consolidated roster.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

interface AgentStatusResponse {
  name: string
  port: number
  status: 'ok' | 'unreachable'
  active_agents: number | null
}

const FEDERATION_PORTS = [8641, 8642, 8643, 8644, 8645]
const AGENT_NAMES: Record<number, string> = {
  8641: 'Nyx',
  8642: 'Lyra',
  8643: 'Alethea',
  8644: 'Cora',
  8645: 'Aether',
}

async function probeAgent(port: number): Promise<AgentStatusResponse> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    
    const res = await fetch(`http://127.0.0.1:${port}/health/detailed`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return { name: AGENT_NAMES[port] ?? `Agent-${port}`, port, status: 'unreachable', active_agents: null }
    }

    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return {
      name: AGENT_NAMES[port] ?? `Agent-${port}`,
      port,
      status: 'ok',
      active_agents: typeof data.active_agents === 'number' ? data.active_agents : null,
    }
  } catch {
    return { name: AGENT_NAMES[port] ?? `Agent-${port}`, port, status: 'unreachable', active_agents: null }
  }
}

export const Route = createFileRoute('/api/federation-agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const agents = await Promise.all(FEDERATION_PORTS.map(probeAgent))

        return json({
          ok: true,
          agents,
          fetchedAt: Date.now(),
        })
      },
    },
  },
})
