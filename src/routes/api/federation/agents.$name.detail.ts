/**
 * Agent detail endpoint — reads SOUL.md, MEMORY.md, and skills directories
 * for a named agent profile. Only the 5 federation agents qualify; claude,
 * default, and unknown names return 404.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

const VALID_AGENT_NAMES = new Set(['nyx', 'lyra', 'alethea', 'cora', 'aether'])

function getProfilesRoot(): string {
  const home = process.env.HOME || '/home/mako'
  return path.join(home, '.hermes', 'profiles')
}

const SHARED_SKILLS_ROOT = '/opt/ai/agents/shared/skills'

function readOptionalFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

function listSkillDirs(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return []
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter(
        (e) => e.isDirectory() && fs.existsSync(path.join(dirPath, e.name, 'SKILL.md')),
      )
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

export const Route = createFileRoute('/api/federation/agents/$name/detail')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
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

        const profileDir = path.join(getProfilesRoot(), name)
        const localSkillsDir = path.join(profileDir, 'skills')

        const soulPath = path.join(profileDir, 'SOUL.md')
        const memoryPath = path.join(profileDir, 'memories', 'MEMORY.md')

        return json({
          ok: true,
          soul: readOptionalFile(soulPath),
          memory: readOptionalFile(memoryPath),
          skills: {
            local: listSkillDirs(localSkillsDir),
            shared: listSkillDirs(SHARED_SKILLS_ROOT),
          },
        })
      },
    },
  },
})
