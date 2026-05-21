/**
 * AgentEventFeed — compact event list panel for the sidebar.
 * Auto-scrolls to bottom as new events arrive.
 */

import { useEffect, useRef } from 'react'
import { useAgentEvents, type AgentEvent } from '@/lib/use-agent-events'

interface AgentEventFeedProps {
  agentName: string
  color: string
  onClose: () => void
}

export function AgentEventFeed({ agentName, color, onClose }: AgentEventFeedProps) {
  const { events, connected } = useAgentEvents(agentName)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (bottomRef.current && containerRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events.length])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  const renderEventLabel = (ev: AgentEvent) => {
    switch (ev.event) {
      case 'tool.started':
        return `▶ ${ev.tool_name ?? 'unknown'}`
      case 'tool.completed':
        return `✓ ${ev.tool_name ?? 'unknown'}`
      case 'reasoning.available':
        const truncated = (ev.content ?? '').slice(0, 120)
        return `💭 ${truncated}${(ev.content ?? '').length > 120 ? '…' : ''}`
      case 'run.completed':
        return '■ run complete'
      default:
        return ev.event
    }
  }

  return (
    <div className="border border-slate-700/50 rounded-md bg-slate-900/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-700/50">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-xs font-medium text-slate-200 capitalize">{agentName}</span>
          {connected && (
            <span className="text-[9px] font-semibold text-emerald-400 bg-emerald-950/50 px-1.5 py-0.5 rounded">
              LIVE
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
          title="Close feed"
        >
          ✕
        </button>
      </div>

      {/* Event list */}
      <div
        ref={containerRef}
        className="max-h-48 overflow-y-auto py-1 px-2 font-mono text-[11px] space-y-0.5"
      >
        {events.length === 0 ? (
          !connected && events.length === 0 ? (
            <div className="text-slate-500 italic">Waiting for events…</div>
          ) : (
            <div className="text-amber-400/70 italic">Reconnecting…</div>
          )
        ) : (
          events.map((ev, i) => (
            <div key={i} className="flex gap-1.5 text-slate-300 leading-snug">
              <span className="text-slate-600 shrink-0">{formatTime(ev.ts)}</span>
              <span className="truncate">{renderEventLabel(ev)}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
