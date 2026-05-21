/**
 * SSE proxy — transparently streams agent events from the federation proxy
 * to the browser. No buffering, no parsing, no auth (EventSource can't send headers).
 */
import { createFileRoute } from '@tanstack/react-router'

const VALID_AGENTS = ['nyx', 'lyra', 'alethea', 'cora', 'aether']

export const Route = createFileRoute('/api/agent-events/$name')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const name = params.name.toLowerCase()
        if (!VALID_AGENTS.includes(name)) {
          return new Response('Not Found', { status: 404 })
        }

        const upstream = await fetch(
          `http://127.0.0.1:9500/api/agents/${name}/events`,
          { signal: request.signal },
        )

        return new Response(upstream.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
