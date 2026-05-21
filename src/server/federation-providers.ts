/**
 * Resolve federation gateway URLs from the static agent roster.
 *
 * Synchronous — no probing needed. The live status is already handled by
 * useAgentRoster() in the UI component layer. This module only maps
 * agent names to their gateway base URLs.
 */

import { STATIC_AGENTS } from '@/lib/federation-roster'

/** Resolve gateway URL for a specific agent name (case-insensitive). */
export function resolveGatewayUrl(agentName: string): string {
  if (!agentName) return ''
  const key = Object.keys(STATIC_AGENTS).find(
    (k) => k.toLowerCase() === agentName.toLowerCase(),
  )
  if (!key) return ''
  return `http://127.0.0.1:${STATIC_AGENTS[key].port}`
}
