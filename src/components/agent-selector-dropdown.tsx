'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAgentRoster } from '@/lib/federation-roster'
import { setLocalModelOverride } from '@/screens/chat/local-model-override'
import {
  MenuRoot,
  MenuTrigger,
  MenuContent,
  MenuItem,
} from '@/components/ui/menu'

const STORAGE_KEY = 'locus-selected-agent'

export function AgentSelectorDropdown() {
  const { agents } = useAgentRoster()
  const [selectedName, setSelectedName] = useState<string>('')
  const [open, setOpen] = useState(false)

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        setSelectedName(saved)
        setLocalModelOverride(saved)
      }
    } catch { /* ignore */ }
  }, [])

  // Find currently selected agent info for display
  const selectedAgent = agents.find((a) => a.name.toLowerCase() === selectedName.toLowerCase())

  const handleSelect = useCallback(
    (name: string) => {
      const lower = name.toLowerCase()
      setSelectedName(lower)
      setOpen(false)
      try { localStorage.setItem(STORAGE_KEY, lower) } catch { /* ignore */ }
      setLocalModelOverride(lower)
    },
    [],
  )

  const handleClear = useCallback(() => {
    setSelectedName('')
    setOpen(false)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setLocalModelOverride('')
  }, [])

  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger>
        <button
          type="button"
          className="mr-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--theme-card2)] border border-transparent hover:border-[var(--theme-border)]"
          style={{ color: 'var(--theme-text)' }}
          aria-label="Select agent"
        >
          {selectedAgent ? (
            <>
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ backgroundColor: selectedAgent.color }}
              />
              <span>{selectedAgent.name}</span>
            </>
          ) : (
            'Agent ▾'
          )}
        </button>
      </MenuTrigger>

      <MenuContent side="bottom" align="end">
        {agents.map((agent) => {
          const isSelected = agent.name.toLowerCase() === selectedName.toLowerCase()
          return (
            <MenuItem
              key={agent.name}
              onClick={() => handleSelect(agent.name)}
              className={isSelected ? 'font-semibold' : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'space-between',
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className={`inline-block size-2 rounded-full shrink-0 ${agent.status !== 'ok' ? 'opacity-40 grayscale' : ''}`}
                  style={{ backgroundColor: agent.color }}
                />
                <span>{agent.name}</span>
              </span>
              {isSelected && (
                <span className="text-xs opacity-60">✓</span>
              )}
            </MenuItem>
          )
        })}

        {/* Clear selection option */}
        {selectedName && (
          <>
            <div
              style={{
                height: '1px',
                margin: '4px 8px',
                backgroundColor: 'var(--theme-border)',
              }}
            />
            <MenuItem onClick={handleClear}>
              Default (auto)
            </MenuItem>
          </>
        )}
      </MenuContent>
    </MenuRoot>
  )
}
