/**
 * Voice List API — returns available voice files for autocomplete/browser.
 * GET /api/voice-list
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'

const VOICES_DIR = '/opt/ai/shared/voices'
const VALID_EXTS = new Set(['.wav', '.ogg'])

async function scanVoices(): Promise<Array<{ name: string; relativePath: string; sizeBytes: number }>> {
  const voices: Array<{ name: string; relativePath: string; sizeBytes: number }> = []

  try {
    // Scan top-level + one level of subdirectories
    const entries = await fs.readdir(VOICES_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile()) {
        // Top-level files (legacy flat structure — still supported)
        const ext = path.extname(entry.name).toLowerCase()
        if (!VALID_EXTS.has(ext)) continue
        const stat = await fs.stat(path.join(VOICES_DIR, entry.name))
        voices.push({
          name: path.basename(entry.name, ext),
          relativePath: entry.name,
          sizeBytes: stat.size,
        })
      } else if (entry.isDirectory()) {
        // Subdirectory structure: <slug>/reference.wav
        const subDir = path.join(VOICES_DIR, entry.name)
        try {
          const subEntries = await fs.readdir(subDir, { withFileTypes: true })
          for (const subEntry of subEntries) {
            if (!subEntry.isFile()) continue
            const ext = path.extname(subEntry.name).toLowerCase()
            if (!VALID_EXTS.has(ext)) continue
            const relPath = path.join(entry.name, subEntry.name)
            const stat = await fs.stat(path.join(VOICES_DIR, relPath))
            voices.push({
              name: entry.name, // use directory name as voice slug
              relativePath: relPath,
              sizeBytes: stat.size,
            })
          }
        } catch { /* skip unreadable subdirectories */ }
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable
  }

  return voices
}

export const Route = createFileRoute('/api/voice-list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const voices = await scanVoices()
        return json({ ok: true, voices })
      },
    },
  },
})
