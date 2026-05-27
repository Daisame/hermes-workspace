/**
 * Skill content endpoint — reads SKILL.md for a named agent skill.
 * Supports three scopes: 'local' (agent profile, default), 'shared'
 * (/opt/ai/agents/shared/skills/), and 'hermes' (~/.hermes/skills/).
 * Accepts either `skillName` (searches recursively) or `skillPath`
 * (direct relative path like "creative/comfyui") query parameters.
 */
import fs, { Dirent } from 'node:fs'
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
        const skillPath = url.searchParams.get('skillPath')
        const skillName = url.searchParams.get('skillName')
        if (!skillPath && !skillName) {
          return json(
            { ok: false, error: 'Missing skillPath or skillName query parameter' },
            { status: 400 },
          )
        }

        const scope = (url.searchParams.get('scope') || 'local').toLowerCase()

        // Determine the skills directory based on scope
        let skillsDir: string
        if (scope === 'shared') {
          skillsDir = SHARED_SKILLS_ROOT
        } else if (scope === 'hermes') {
          skillsDir = HERMES_GLOBAL_SKILLS_ROOT
        } else {
          const profileDir = path.join(getProfilesRoot(), name)
          skillsDir = path.join(profileDir, 'skills')
        }

        // If skillPath provided, resolve directly — skip search loop
        let resolvedSkillPath: string | null = null
        if (skillPath && skillPath.trim()) {
          const candidate = path.join(skillsDir, skillPath.trim(), 'SKILL.md')
          try {
            if (fs.existsSync(candidate)) {
              resolvedSkillPath = candidate
            }
          } catch {/* fall through to search */}
        }

        // Fallback: search by skillName (existing behavior)
        if (!resolvedSkillPath && skillName) {
          try {
            if (!fs.existsSync(skillsDir)) return json({ ok: false, error: 'Skills directory not found' }, { status: 404 })

            const entries: Dirent[] = fs.readdirSync(skillsDir, { withFileTypes: true })
            for (const entry of entries) {
              // Direct child: skills/<skillName>/SKILL.md
              if (entry.isDirectory()) {
                const directSkillMd = path.join(skillsDir, entry.name, 'SKILL.md')
                if (entry.name === skillName && fs.existsSync(directSkillMd)) {
                  resolvedSkillPath = directSkillMd
                  break
                }
                // Nested category: skills/<category>/<skillName>/SKILL.md
                try {
                  const nestedEntries: Dirent[] = fs.readdirSync(path.join(skillsDir, entry.name), { withFileTypes: true })
                  for (const nested of nestedEntries) {
                    if (nested.isDirectory() && nested.name === skillName) {
                      const nestedSkillMd = path.join(skillsDir, entry.name, nested.name, 'SKILL.md')
                      if (fs.existsSync(nestedSkillMd)) {
                        resolvedSkillPath = nestedSkillMd
                        break
                      }
                    }
                  }
                } catch {/* skip unreadable dirs */}
              }
              if (resolvedSkillPath) break
            }
          } catch {
            return json({ ok: false, error: 'Failed to read skills directory' }, { status: 500 })
          }
        }

        if (!resolvedSkillPath) {
          const lookupName = skillPath || skillName
          return json(
            { ok: false, error: `Skill not found: ${lookupName}` },
            { status: 404 },
          )
        }

        try {
          const content = fs.readFileSync(resolvedSkillPath, 'utf-8')
          // Strip YAML frontmatter for cleaner display
          let displayContent = content
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
          if (frontmatterMatch) {
            displayContent = content.substring(frontmatterMatch[0].length)
          }

          return json({
            ok: true,
            skillName: skillPath || skillName,
            scope,
            path: resolvedSkillPath,
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
