/**
 * useAgentEvents — EventSource hook for live agent event streams.
 *
 * Usage:
 *   const { events, connected, clearEvents } = useAgentEvents('nyx')
 */

import { useEffect, useState, useCallback, useRef } from 'react'

export interface AgentEvent {
  event: string
  agent: string
  tool_name?: string
  result?: string
  content?: string
  ts: number
}

const MAX_EVENTS = 50

export function useAgentEvents(agentName: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  useEffect(() => {
    // Reset state and close any existing connection when agent changes
    setEvents([])
    setConnected(false)
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    if (!agentName) {
      setConnected(false)
      return
    }

    const url = `/api/agent-events/${agentName.toLowerCase()}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as Omit<AgentEvent, 'ts'>
        setEvents((prev) => [
          ...prev,
          { ...parsed, ts: Date.now() },
        ].slice(-MAX_EVENTS))
      } catch {
        // Skip non-JSON lines (keepalive comments, etc.)
      }
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [agentName])

  return { events, connected, clearEvents }
}
