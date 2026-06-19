/**
 * Agent allowlist — single source of truth derived from agents.json.
 * All API routes and UI components should import this instead of hardcoding names.
 */

import fs from 'node:fs'

const AGENTS_JSON_PATH = '/opt/ai/hermes-workspace-fork/agents.json'

function loadAgentNames(): Set<string> {
  try {
    if (!fs.existsSync(AGENTS_JSON_PATH)) return new Set()
    const data = JSON.parse(fs.readFileSync(AGENTS_JSON_PATH, 'utf-8')) as { agents?: Array<{ name: string }> }
    return new Set((data.agents || []).map((a) => a.name.toLowerCase()))
  } catch {
    console.warn('[agent-allowlist] Failed to parse agents.json, using empty set')
    return new Set()
  }
}

export const VALID_AGENT_NAMES: ReadonlySet<string> = loadAgentNames()
