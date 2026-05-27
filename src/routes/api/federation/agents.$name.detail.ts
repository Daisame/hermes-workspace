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
const HERMES_GLOBAL_SKILLS_ROOT = path.join(
  process.env.HOME || '/home/mako', '.hermes', 'skills'
)

function readOptionalFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

interface SkillEntry {
  name: string
  relativePath: string
  category: string | null
}

/** Recursively find all directories containing SKILL.md at any depth. */
function listSkillsRecursive(dirPath: string): SkillEntry[] {
  try {
    if (!fs.existsSync(dirPath)) return []

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const results: SkillEntry[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const entryPath = path.join(dirPath, entry.name)

      // Check direct SKILL.md in this directory
      const skillMdPath = path.join(entryPath, 'SKILL.md')
      if (fs.existsSync(skillMdPath)) {
        const relativePath = path.relative(dirPath, entryPath)
        const parts = relativePath.split(path.sep)
        results.push({
          name: entry.name,
          relativePath,
          category: parts.length > 1 ? parts[0] : null,
        })
        continue
      }

      // Recurse into subdirectories
      results.push(...listSkillsRecursive(entryPath).map((child) => {
        const fullPath = path.join(entry.name, child.relativePath)
        return {
          ...child,
          relativePath: fullPath,
          category: fullPath.includes(path.sep) ? fullPath.split(path.sep)[0] : null,
        }
      })) as SkillEntry[]
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Check if a SKILL.md has Hermes hub frontmatter signature. */
function isHermesHubSkill(skillMdPath: string): boolean {
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    return /^metadata:\s*\n\s+hermes:/m.test(content)
  } catch {
    return false
  }
}

/** Build a Set of relative paths from the global Hermes skills directory. */
function buildGlobalSkillSet(): Set<string> {
  const globalSkills = listSkillsRecursive(HERMES_GLOBAL_SKILLS_ROOT)
  return new Set(globalSkills.map((s) => s.relativePath))
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

        // Collect all local skills recursively
        const allLocalSkills = listSkillsRecursive(localSkillsDir)
        const globalSet = buildGlobalSkillSet()

        const hermes: SkillEntry[] = []
        const custom: SkillEntry[] = []
        for (const skill of allLocalSkills) {
          const skillMdPath = path.join(localSkillsDir, skill.relativePath, 'SKILL.md')
          const hubByFrontmatter = isHermesHubSkill(skillMdPath)
          if (hubByFrontmatter || globalSet.has(skill.relativePath)) {
            hermes.push(skill)
          } else {
            custom.push(skill)
          }
        }

        return json({
          ok: true,
          soul: readOptionalFile(soulPath),
          memory: readOptionalFile(memoryPath),
          skills: {
            hermes,
            custom,
            shared: listSkillsRecursive(SHARED_SKILLS_ROOT),
          },
        })
      },
    },
  },
})
