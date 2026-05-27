/**
 * Agent avatar upload endpoint — saves an image file as /public/avatars/{name}.jpg.
 * Only the 5 federation agents qualify; invalid names or non-image files return errors.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const AVATARS_DIR = '/opt/ai/hermes-workspace-fork/public/avatars'
const VALID_AGENT_NAMES = new Set(['nyx', 'lyra', 'alethea', 'cora', 'aether'])
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

export const Route = createFileRoute('/api/federation/agents/$name/avatar')({
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

        const formData = await request.formData()
        const file = formData.get('avatar')

        if (!file || !(file instanceof File)) {
          return json(
            { ok: false, error: 'No avatar file provided' },
            { status: 400 },
          )
        }

        if (!file.type.startsWith('image/')) {
          return json(
            { ok: false, error: 'File must be an image (JPEG, PNG, or WebP)' },
            { status: 415 },
          )
        }

        if (file.size > MAX_BYTES) {
          return json(
            { ok: false, error: 'Image too large (max 5MB)' },
            { status: 413 },
          )
        }

        const destPath = path.join(AVATARS_DIR, `${name}.jpg`)
        const buffer = Buffer.from(await file.arrayBuffer())
        fs.mkdirSync(AVATARS_DIR, { recursive: true })
        fs.writeFileSync(destPath, buffer)

        return json({ ok: true, path: `/avatars/${name}.jpg` })
      },
    },
  },
})
