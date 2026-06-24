/**
 * Voice Status API — returns ffprobe metadata for an agent's current voice file.
 * GET /api/voice-status?agentName=<name>
 */
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getVoiceMetadata } from '../../server/voice-utils'

const VOICES_DIR = '/opt/ai/moss-tts/voices'

export const Route = createFileRoute('/api/voice-status')({
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

        const metadata = await getVoiceMetadata(agentName)

        return json({
          ok: true,
          agentName,
          voiceFile: path.join(VOICES_DIR, `${agentName}.wav`),
          hasVoice: !!metadata,
          metadata,
        })
      },
    },
  },
})
