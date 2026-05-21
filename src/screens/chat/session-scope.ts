/**
 * Session scope — tracks which agent owns the current session context.
 *
 * When an agent is selected via AgentSelectorDropdown, setSessionScope()
 * updates this module-level state. All downstream session key resolution
 * then produces scoped keys: `agent:<name>:<friendlyId>`.
 */

// Module-level session scope — tracks active agent for session key scoping.
export let _sessionScope = ''  // e.g., 'nyx', 'lyra', etc.

export function setSessionScope(agentName: string | null): void {
  _sessionScope = agentName || ''
}

export function getSessionScope(): string {
  return _sessionScope
}

/** Build a scoped session key from an agent name and friendly ID. */
export function buildScopedKey(agentName: string, friendlyId: string): string {
  if (!agentName) return friendlyId
  // Avoid double-scoping existing keys
  if (friendlyId.startsWith(`agent:${agentName}:`)) return friendlyId
  return `agent:${agentName}:${friendlyId}`
}

/** Extract agent name from a scoped key, or null if unscoped. */
export function extractAgentFromKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:(\w+):/)
  return match ? match[1] : null
}
