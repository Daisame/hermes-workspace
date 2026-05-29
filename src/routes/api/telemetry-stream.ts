import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth } from '../../server/auth-middleware'

const TELEMETRY_UPSTREAM = 'http://localhost:9500/api/telemetry/stream'

export const Route = createFileRoute('/api/telemetry-stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            let isStreamActive = true

            const send = (event: string, data: unknown) => {
              if (!isStreamActive || controller.desiredSize === null) return
              try {
                controller.enqueue(
                  encoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
                  ),
                )
              } catch {
                isStreamActive = false
              }
            }

            const keepAlive = setInterval(() => {
              send('ping', { t: Date.now() })
            }, 8000)

            try {
              const upstream = await fetch(TELEMETRY_UPSTREAM, {
                signal: request.signal,
              })

              if (!upstream.ok || !upstream.body) {
                send('error', {
                  message: `Telemetry daemon returned ${upstream.status}`,
                })
                isStreamActive = false
                controller.close()
                clearInterval(keepAlive)
                return
              }

              const reader = upstream.body.getReader()
              const decoder = new TextDecoder()
              let buffer = ''

              while (isStreamActive) {
                const { done, value } = await reader.read()
                if (done || !isStreamActive) break

                buffer += decoder.decode(value, { stream: true })

                // Split on SSE double-newline boundaries
                const parts = buffer.split('\n\n')
                buffer = parts.pop() ?? ''

                for (const part of parts) {
                  if (!part.trim()) continue
                  send('data', part)
                }
              }

              // Flush remaining buffer
              if (buffer.trim()) {
                send('data', buffer)
              }

            } catch (err) {
              if (isStreamActive) {
                send('error', { message: String(err) })
              }
            } finally {
              isStreamActive = false
              clearInterval(keepAlive)
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
