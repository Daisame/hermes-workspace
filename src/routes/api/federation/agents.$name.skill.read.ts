/**
 * Skill content endpoint — reads SKILL.md for a named agent skill.
 * Supports both local agent skills (~/.hermes/profiles/<name>/skills/) and
 * shared pool skills (/opt/ai/agents/shared/skills/). The `scope` query param
 * selects which: 'local' (default) or 'shared'. Returns 404 if not found.
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

export const Route = createFileRoute(
  '/api/federation/agents/$name/skill/read',
)({
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

        const url = new URL(request.url)
        const skillName = url.searchParams.get('skillName')
        if (!skillName) {
          return json(
            { ok: false, error: 'Missing skillName query parameter' },
            { status: 400 },
          )
        }

        const scope = (url.searchParams.get('scope') || 'local').toLowerCase()

        // Determine the skills directory based on scope
        let skillsDir: string
        if (scope === 'shared') {
          skillsDir = SHARED_SKILLS_ROOT
        } else {
          const profileDir = path.join(getProfilesRoot(), name)
          skillsDir = path.join(profileDir, 'skills')
        }

        // Find the SKILL.md — skill dirs may be nested (e.g. category/skill-name/SKILL.md)
        let skillPath: string | null = null
        try {
          if (!fs.existsSync(skillsDir)) return json({ ok: false, error: 'Skills directory not found' }, { status: 404 })

          const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
          for (const entry of entries) {
            // Direct child: skills/<skillName>/SKILL.md
            if (entry.isDirectory()) {
              const directSkillMd = path.join(skillsDir, entry.name, 'SKILL.md')
              if (entry.name === skillName && fs.existsSync(directSkillMd)) {
                skillPath = directSkillMd
                break
              }
              // Nested category: skills/<category>/<skillName>/SKILL.md
              const nestedEntries = fs.readdirSync(path.join(skillsDir, entry.name), { withFileTypes: true })
              for (const nested of nestedEntries) {
                if (nested.isDirectory() && nested.name === skillName) {
                  const nestedSkillMd = path.join(skillsDir, entry.name, nested.name, 'SKILL.md')
                  if (fs.existsSync(nestedSkillMd)) {
                    skillPath = nestedSkillMd
                    break
                  }
                }
              }
            }
            if (skillPath) break
          }
        } catch {
          return json({ ok: false, error: 'Failed to read skills directory' }, { status: 500 })
        }

        if (!skillPath) {
          return json(
            { ok: false, error: `Skill not found: ${skillName}` },
            { status: 404 },
          )
        }

        try {
          const content = fs.readFileSync(skillPath, 'utf-8')
          // Strip YAML frontmatter for cleaner display
          let displayContent = content
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
          if (frontmatterMatch) {
            displayContent = content.substring(frontmatterMatch[0].length)
          }

          return json({
            ok: true,
            skillName,
            scope,
            path: skillPath,
            content: displayContent,
          })
        } catch {
          return json(
            { ok: false, error: 'Failed to read SKILL.md' },
            { status: 500 },
          )
        }
      },
    },
  },
})
