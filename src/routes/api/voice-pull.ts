/**
 * Voice Pull API — generates a voice seed from ElevenLabs and returns ffprobe metadata.
 * POST /api/voice-pull  { agentName, voiceId, seedText?, model? }
 */
import path from 'node:path'
import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { runCommand, getVoiceMetadata } from '../../server/voice-utils'

const VOICES_DIR = '/opt/ai/shared/voices'
const PULL_SCRIPT = '/opt/ai/bin/elevenlabs-pull'
const DEFAULT_SEED_TEXT =
  'The quick beige fox jumps over the lazy dog, while technical metrics show zero acoustic drift across the localized subnets.'
const DEFAULT_MODEL = 'eleven_multilingual_v2'

export const Route = createFileRoute('/api/voice-pull')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: any
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const agentName = (body.agentName || '').trim().toLowerCase()
        const voiceId = (body.voiceId || '').trim()
        if (!agentName) {
          return json({ ok: false, error: 'agentName is required' }, { status: 400 })
        }
        if (!voiceId) {
          return json({ ok: false, error: 'voiceId is required' }, { status: 400 })
        }

        const seedText = body.seedText || DEFAULT_SEED_TEXT
        const model = body.model || DEFAULT_MODEL

        // Build command args
        const args: Array<string> = ['generate', voiceId, agentName]
        if (seedText !== DEFAULT_SEED_TEXT) {
          args.push('--text', seedText)
        }
        if (model !== DEFAULT_MODEL) {
          args.push('--model', model)
        }

        // Check script exists
        if (!fs.existsSync(PULL_SCRIPT)) {
          return json(
            { ok: false, error: `Pull script not found: ${PULL_SCRIPT}` },
            { status: 500 },
          )
        }

        // Execute elevenlabs-pull directly (not bash)
        const pullResult = await runCommand(PULL_SCRIPT, args, 60_000)
        if (pullResult.code !== 0) {
          return json(
            {
              ok: false,
              error: `Pull failed: ${pullResult.stderr.trim() || 'Unknown error'}`,
              output: pullResult.stdout.trim(),
            },
            { status: 500 },
          )
        }

        // Get ffprobe metadata of the resulting WAV
        const metadata = await getVoiceMetadata(agentName)

        return json({
          ok: true,
          message: `Voice pulled for ${agentName}`,
          voiceFile: path.join(VOICES_DIR, agentName, 'reference.wav'),
          metadata,
          pullOutput: pullResult.stdout.trim(),
        })
      },
    },
  },
})
