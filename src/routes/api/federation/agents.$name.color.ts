/**
 * Agent color update endpoint — PATCHes the accent color in agents.json.
 * Only the 5 federation agents qualify; invalid names or colors return errors.
 */
import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const AGENTS_JSON = '/opt/ai/hermes-workspace-fork/agents.json'
const VALID_AGENT_NAMES = new Set(['nyx', 'lyra', 'alethea', 'cora', 'aether'])
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const Route = createFileRoute('/api/federation/agents/$name/color')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const name = (params.name || '').toLowerCase()
        if (!VALID_AGENT_NAMES.has(name)) {
          return json(
            { ok: false, error: `Unknown agent: ${params.name}` },
            { status: 404 },
          )
        }

        let body
        try {
          body = (await request.json()) as { color?: string }
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const color = body.color?.trim() || ''
        if (!HEX_COLOR.test(color)) {
          return json(
            { ok: false, error: 'Color must be a hex value (#rrggbb)' },
            { status: 400 },
          )
        }

        const data = JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf-8'))
        const agent = data.agents?.find(
          (a: { name: string }) => a.name.toLowerCase() === name,
        )
        if (!agent) {
          return json(
            { ok: false, error: `Agent not found in agents.json: ${name}` },
            { status: 404 },
          )
        }

        agent.color = color
        fs.writeFileSync(AGENTS_JSON, JSON.stringify(data, null, 2) + '\n')

        return json({ ok: true })
      },
    },
  },
})
