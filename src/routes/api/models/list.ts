import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const LM_STUDIO_URL = 'http://10.100.1.3:1234/api/v0/models'

export interface ModelEntry {
  id: string
  displayName: string
  state: 'loaded' | 'not-loaded'
  quantization?: string
  maxContextLength: number
  loadedContextLength?: number
  type: string
  publisher?: string
  capabilities?: string[]
}

export const Route = createFileRoute('/api/models/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const response = await fetch(LM_STUDIO_URL, { signal: AbortSignal.timeout(10_000) })
          if (!response.ok) {
            return json({ ok: false, error: `LM Studio returned ${response.status}`, models: [] })
          }

          const body = (await response.json()) as { data?: Array<Record<string, unknown>> }
          const rawModels = body.data ?? []

          // Filter out embedding-only models — they're not chat-capable
          const models: ModelEntry[] = rawModels
            .filter((m) => m.type === 'llm' || m.type === 'vlm')
            .map((m) => ({
              id: (m.id as string) ?? '',
              displayName: formatModelDisplay(m.id as string, m),
              state: (m.state as 'loaded' | 'not-loaded') ?? 'not-loaded',
              quantization: (m.quantization as string) ?? undefined,
              maxContextLength: m.max_context_length != null ? (Number(m.max_context_length) || 0) : 0,
              loadedContextLength: m.loaded_context_length != null ? Number(m.loaded_context_length) : undefined,
              type: (m.type as string) ?? 'llm',
              publisher: (m.publisher as string) ?? undefined,
              capabilities: Array.isArray(m.capabilities) ? (m.capabilities as string[]) : undefined,
            }))

          return json({ ok: true, models })
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to fetch model list'
          return json({ ok: false, error: msg, models: [] })
        }
      },
    },
  },
})

function formatModelDisplay(id: string, meta: Record<string, unknown>): string {
  // Strip quantization suffixes like @q4_k_m for display cleanliness
  let name = id.replace(/@q\d+_?[a-z]+$/i, '')

  // Add quantization badge if available
  const q = meta.quantization as string | undefined
  if (q) {
    name += ` (${q})`
  }

  // Capitalize and clean up
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
