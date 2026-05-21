/**
 * AgentRosterPanel — compact sidebar row of agent cards with live status dots.
 */
import { useState } from 'react'
import { useAgentRoster } from '@/lib/federation-roster'
import { AgentEventFeed } from './agent-event-feed'

export function AgentRosterPanel() {
  const { agents, loading, error } = useAgentRoster()
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  if (loading && agents.length === 0) {
    return <div className="text-xs text-slate-500 p-2">Loading roster…</div>
  }

  if (error && agents.length === 0) {
    return (
      <div className="text-xs text-red-400 p-2" title={error}>
        Roster unavailable
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 items-center justify-center">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            isSelected={selectedAgent === agent.name}
            onSelect={() =>
              setSelectedAgent(
                selectedAgent === agent.name ? null : agent.name,
              )
            }
          />
        ))}
      </div>

      {selectedAgent && (
        <div className="mt-2">
          <AgentEventFeed
            agentName={selectedAgent}
            color={agents.find((a) => a.name.toLowerCase() === selectedAgent.toLowerCase())?.color ?? '#888'}
            onClose={() => setSelectedAgent(null)}
          />
        </div>
      )}
    </>
  )
}

// ── Individual card ───────────────────────────────────────────────────

interface AgentCardProps {
  agent: {
    name: string
    role: string
    color: string
    status: 'ok' | 'unreachable'
    active_agents: number | null
  }
  isSelected: boolean
  onSelect: () => void
}

function AgentCard({ agent, isSelected, onSelect }: AgentCardProps) {
  const isOnline = agent.status === 'ok'

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/60 border transition-colors cursor-pointer ${
        isSelected
          ? ''
          : 'border-slate-700/50 hover:border-slate-600'
      }`}
      style={
        isSelected
          ? { borderColor: agent.color, boxShadow: `0 0 4px ${agent.color}40` }
          : undefined
      }
      title={`${agent.name} — ${agent.role}${isOnline ? '' : ' (offline)'}`}
    >
      {/* Status dot */}
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          backgroundColor: isOnline ? agent.color : '#4b5563',
          boxShadow: isOnline ? `0 0 4px ${agent.color}` : 'none',
        }}
      />

      {/* Name + role */}
      <span className="text-xs font-medium text-slate-200 truncate max-w-[60px]">
        {agent.name}
      </span>

      {/* Active sessions badge (only when online) */}
      {isOnline && agent.active_agents != null && agent.active_agents > 0 && (
        <span className="text-[10px] text-slate-400 bg-slate-700/80 px-1 rounded-sm">
          {agent.active_agents}
        </span>
      )}

      {/* Offline tooltip overlay */}
      {!isOnline && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
          offline
        </span>
      )}
    </div>
  )
}
