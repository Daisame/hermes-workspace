export type PortableHistoryMessage = {
  role: string
  content: string
}

export function shouldReplayPortableHistory(options?: {
  localBaseUrl?: string
  gatewayBaseUrl?: string
  bearerToken?: string
}): boolean {
  const localBaseUrl = options?.localBaseUrl?.trim() || ''
  const gatewayBaseUrl = options?.gatewayBaseUrl?.trim() || ''
  // Direct local-provider / custom-base-url requests: replay history.
  if (localBaseUrl) return true

  // Direct agent gateway routing suppresses X-Hermes-Session-Id (causes 403).
  // Without server-side session binding, we must replay history ourselves so
  // the agent sees conversation context on every turn.
  if (gatewayBaseUrl) return true

  // Default Hermes gateway path: session ID is forwarded, server maintains
  // history — replaying here would duplicate context.
  return false
}

export function selectPortableConversationHistory(
  persistedHistory: Array<PortableHistoryMessage>,
  fallbackHistory: Array<PortableHistoryMessage>,
  options?: {
    localBaseUrl?: string
    bearerToken?: string
  },
): Array<PortableHistoryMessage> {
  if (!shouldReplayPortableHistory(options)) return []
  return persistedHistory.length > 0 ? persistedHistory : fallbackHistory
}
