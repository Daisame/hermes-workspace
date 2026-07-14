/**
 * Voice Upload API — upload a local WAV file as a voice reference.
 * POST /api/voice-upload  multipart { agentName, file }
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getVoiceMetadata } from '../../server/voice-utils'

const VOICES_DIR = '/opt/ai/shared/voices'

export const Route = createFileRoute('/api/voice-upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const formData = await request.formData()
        const agentName = (formData.get('agentName') as string || '').trim().toLowerCase()
        const file = formData.get('file') as File | null

        if (!agentName) {
          return json({ ok: false, error: 'agentName is required' }, { status: 400 })
        }
        if (!file) {
          return json({ ok: false, error: 'voice file is required' }, { status: 400 })
        }

        // Validate extension
        const ext = path.extname(file.name).toLowerCase()
        if (ext !== '.wav') {
          return json(
            { ok: false, error: 'Only .wav files are supported' },
            { status: 400 },
          )
        }

        // Write to canonical location
        const voiceDir = path.join(VOICES_DIR, agentName)
        await fs.mkdir(voiceDir, { recursive: true })
        const dstPath = path.join(voiceDir, 'reference.wav')

        const buffer = Buffer.from(await file.arrayBuffer())
        await fs.writeFile(dstPath, buffer)

        // Get ffprobe metadata of the uploaded WAV
        const metadata = await getVoiceMetadata(agentName)

        return json({
          ok: true,
          message: `Voice uploaded for ${agentName}`,
          voiceFile: dstPath,
          metadata,
        })
      },
    },
  },
})
