/**
 * Voice Delete API — delete an existing voice directory.
 * POST /api/voice-delete  JSON { voiceName }
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const VOICES_DIR = '/opt/ai/shared/voices'

export const Route = createFileRoute('/api/voice-delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json().catch(() => ({}))
        const voiceName = (body.voiceName as string || '').trim()

        if (!voiceName) {
          return json({ ok: false, error: 'voiceName is required' }, { status: 400 })
        }

        // Path validation — reject traversal attempts and invalid characters
        if (/[/\.\.]/.test(voiceName)) {
          return json({ ok: false, error: 'Invalid voice name' }, { status: 400 })
        }

        const targetPath = path.resolve(VOICES_DIR, voiceName)
        if (!targetPath.startsWith(path.resolve(VOICES_DIR) + path.sep)) {
          return json({ ok: false, error: 'Access denied' }, { status: 403 })
        }

        // Block deletion of the system fallback "default" voice
        if (voiceName === 'default') {
          return json(
            { ok: false, error: "Cannot delete 'default' — this is a system fallback voice" },
            { status: 403 },
          )
        }

        // Check target exists and is inside VOICES_DIR scope
        try {
          const stat = await fs.stat(targetPath)
          if (!stat.isDirectory()) {
            return json({ ok: false, error: 'Voice path must be a directory' }, { status: 400 })
          }
        } catch {
          return json(
            { ok: false, error: `Voice '${voiceName}' not found` },
            { status: 404 },
          )
        }

        // Delete the voice directory recursively
        await fs.rm(targetPath, { recursive: true, force: true })

        return json({
          ok: true,
          message: `Voice '${voiceName}' deleted`,
        })
      },
    },
  },
})
