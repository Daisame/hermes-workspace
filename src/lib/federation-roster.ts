/**
 * Federation roster — fetches live agent status from the workspace's
 * federation proxy and merges it with static metadata from agents.json.
 *
 * Usage:
 *   const { agents, loading, error } = useAgentRoster();
 */

import { useEffect, useState, useCallback, useRef } from 'react'

// ── Static agent metadata (mirrors agents.json) ───────────────────────

export interface AgentStaticConfig {
  name: string
  role: string
  port: number
  color: string
}

export const STATIC_AGENTS: Record<string, AgentStaticConfig> = {
  Nyx:     { name: 'Nyx',     role: 'Coder',    port: 8641, color: '#a78bfa' },
  Lyra:    { name: 'Lyra',    role: 'Editor',   port: 8642, color: '#34d399' },
  Alethea: { name: 'Alethea', role: 'Research', port: 8643, color: '#60a5fa' },
  Cora:    { name: 'Cora',    role: 'DevOps',   port: 8644, color: '#f59e0b' },
  Aether:  { name: 'Aether',  role: 'Auditor',  port: 8645, color: '#f87171' },
}

// ── Types ─────────────────────────────────────────────────────────────

export interface AgentInfo {
  name: string
  port: number
  role: string
  color: string
  status: 'ok' | 'unreachable'
  active_agents: number | null
}

interface FederationAgentRaw {
  name: string
  port: number
  status: string
  active_agents?: number | null
}

// ── Fetch function ────────────────────────────────────────────────────

export async function fetchAgentRoster(): Promise<AgentInfo[]> {
  const res = await fetch('/api/federation-agents')
  if (!res.ok) {
    throw new Error(`Federation roster fetch failed: ${res.status}`)
  }
  const data = (await res.json()) as { agents?: FederationAgentRaw[] }

  return (data.agents ?? []).map((raw) => {
    const staticInfo = STATIC_AGENTS[raw.name] || {
      name: raw.name,
      role: 'Unknown',
      port: raw.port,
      color: '#888888',
    }

    return {
      name: raw.name,
      port: raw.port,
      role: staticInfo.role,
      color: staticInfo.color,
      status: (raw.status === 'ok' ? 'ok' : 'unreachable') as AgentInfo['status'],
      active_agents: raw.active_agents ?? null,
    }
  })
}

// ── React hook — polls every 5s ───────────────────────────────────────

export function useAgentRoster() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const roster = await fetchAgentRoster()
      setAgents(roster)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch roster')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    timerRef.current = window.setInterval(refresh, 5_000)
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current)
    }
  }, [refresh])

  return { agents, loading, error }
}
