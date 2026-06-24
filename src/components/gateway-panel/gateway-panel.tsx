/**
 * Gateway Control Panel — shows configured vs live gateway state with Start/Stop/Restart controls.
 * Renders as a tab inside the Agent Profile page.
 */
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { DialogRoot, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'

type GatewayConfiguredInfo = {
  baseUrl: string | null
  model: string | null
  contextLength: number | null
  provider: string | null
} | null

type GatewayLiveInfo = {
  serviceStatus: 'active' | 'inactive' | 'failed' | 'unknown'
  lastRestart: string | null
  pid: number | null
  activeAgents: number | null
  gatewayState: string | null
  platformsConnected: Array<string>
}

type GatewayPanelProps = {
  agentId: string
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    // Show relative time for recent restarts, absolute otherwise
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    return d.toLocaleString()
  } catch {
    return value
  }
}

function formatContextLength(value: number | null): string {
  if (!value) return '—'
  if (value >= 1024 * 1024) return `${value / 1024 / 1024}M`
  if (value >= 1024) return `${value / 1024}K`
  return String(value)
}

function formatBaseUrl(url: string | null): string {
  if (!url) return '—'
  // Truncate for display — show protocol + host only, omit path if long
  try {
    const u = new URL(url)
    return `${u.protocol.replace(':', '')}://${u.host}`
  } catch {
    return url.length > 40 ? url.slice(0, 37) + '...' : url
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'text-emerald-500'
    case 'inactive': return 'text-slate-400'
    case 'failed': return 'text-red-500'
    default: return 'text-slate-500'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'active': return 'bg-emerald-500'
    case 'inactive': return 'bg-slate-400'
    case 'failed': return 'bg-red-500'
    default: return 'bg-slate-500'
  }
}

async function fetchGatewayStatus(agentName: string): Promise<{
  configured: GatewayConfiguredInfo
  live: GatewayLiveInfo | null
  hasMismatch: boolean
}> {
  try {
    const res = await fetch(`/api/gateway-agent-status?agentName=${encodeURIComponent(agentName)}`)
    if (!res.ok) return { configured: null, live: null, hasMismatch: false }
    const data = await res.json()
    return {
      configured: data.configured || null,
      live: data.live || null,
      hasMismatch: !!data.hasMismatch,
    }
  } catch {
    return { configured: null, live: null, hasMismatch: false }
  }
}

async function executeGatewayAction(
  agentName: string,
  action: 'start' | 'stop' | 'restart',
): Promise<{ ok: boolean; message: string; serviceStatus?: string }> {
  const response = await fetch('/api/gateway-control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentName, action }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${response.status}`)
  }

  return await response.json()
}

export function GatewayPanel({ agentId }: GatewayPanelProps) {
  const [configured, setConfigured] = useState<GatewayConfiguredInfo>(null)
  const [live, setLive] = useState<GatewayLiveInfo | null>(null)
  const [hasMismatch, setHasMismatch] = useState(false)
  const [loading, setLoading] = useState(true)

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'start' | 'stop' | 'restart' | null>(null)

  // Load gateway status on mount and poll every 30s
  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (cancelled) return
      setLoading(true)
      fetchGatewayStatus(agentId.toLowerCase())
        .then((data) => {
          if (!cancelled) {
            setConfigured(data.configured)
            setLive(data.live)
            setHasMismatch(data.hasMismatch)
            setLoading(false)
          }
        })
    }

    load()
    const interval = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [agentId])

  // Control action mutation
  const controlMutation = useMutation({
    mutationFn: async (action: 'start' | 'stop' | 'restart') =>
      executeGatewayAction(agentId.toLowerCase(), action),
    onSuccess: () => {
      toast(`Gateway ${pendingAction}ed for ${agentId}`, { type: 'success' })
      setConfirmOpen(false)
      setPendingAction(null)
      // Refresh status immediately
      fetchGatewayStatus(agentId.toLowerCase()).then((data) => {
        setConfigured(data.configured)
        setLive(data.live)
        setHasMismatch(data.hasMismatch)
      })
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Operation failed', { type: 'error' })
      setConfirmOpen(false)
      setPendingAction(null)
    },
  })

  const isOperating = controlMutation.isPending

  function handleControl(action: 'start' | 'stop' | 'restart') {
    if (isOperating) return
    setPendingAction(action)
    setConfirmOpen(true)
  }

  function confirmAction() {
    if (!pendingAction) return
    controlMutation.mutate(pendingAction)
  }

  const actionLabel: Record<string, string> = {
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
  }

  const actionDescription: Record<string, string> = {
    start: `This will start the ${agentId} gateway service. Takes ~3-5 seconds.`,
    stop: `This will stop the ${agentId} gateway service. Active sessions will be interrupted.`,
    restart: `This will restart the ${agentId} gateway service. Active sessions will reconnect automatically.`,
  }

  const liveStatus = live?.serviceStatus || 'unknown'

  return (
    <div className="space-y-4">
      {/* Mismatch Warning */}
      {hasMismatch && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ Configured settings don&apos;t match live state — the gateway may not have picked up a recent config change.
        </div>
      )}

      {/* Status Overview */}
      <div className="rounded-2xl border border-primary-200 bg-primary-50/80 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-500">
          Gateway Status
        </h3>

        {loading ? (
          <div className="text-sm text-primary-500">Loading gateway status…</div>
        ) : live ? (
          <div className="flex items-center gap-4 mb-4">
            {/* Live status indicator */}
            <div className={`w-3 h-3 rounded-full ${statusBg(liveStatus)}`} />
            <span className={`text-sm font-medium capitalize ${statusColor(liveStatus)}`}>
              {liveStatus}
            </span>
            {live.pid && (
              <span className="text-xs text-primary-400">PID {live.pid}</span>
            )}
            {live.activeAgents !== null && live.activeAgents >= 0 && (
              <span className="text-xs text-primary-400">{live.activeAgents} active</span>
            )}
          </div>
        ) : (
          <div className="mb-4 text-sm text-slate-500">Unable to reach gateway</div>
        )}

        {/* Configured vs Live columns */}
        {!loading && configured && live ? (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Configured Column */}
            <div className="rounded-xl border border-primary-100 bg-primary-100/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400">
                Configured (config.yaml)
              </p>
              {([
                ['Endpoint', formatBaseUrl(configured.baseUrl)],
                ['Model', configured.model || '—'],
                ['Context Length', formatContextLength(configured.contextLength)],
                ['Provider', configured.provider || '—'],
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="flex justify-between py-0.5">
                  <span className="text-xs text-primary-500">{label}</span>
                  <span className="text-xs font-medium text-primary-900">{value}</span>
                </div>
              ))}
            </div>

            {/* Live Column */}
            <div className="rounded-xl border border-primary-100 bg-primary-100/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary-400">
                Live (runtime)
              </p>
              {([
                ['Service', live.serviceStatus],
                ['Gateway State', live.gatewayState || '—'],
                ['Last Restart', formatTimestamp(live.lastRestart)],
                ['Platforms', live.platformsConnected.length > 0 ? live.platformsConnected.join(', ') : 'none'],
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="flex justify-between py-0.5">
                  <span className="text-xs text-primary-500">{label}</span>
                  <span className={`text-xs font-medium ${
                    label === 'Service' ? statusColor(value) : 'text-primary-900'
                  }`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* No config state */}
        {!loading && !configured && (
          <div className="rounded-xl border border-dashed border-primary-200 bg-primary-100/60 px-4 py-6 text-center mt-3">
            <p className="text-sm font-medium text-primary-700">No configuration found</p>
            <p className="mt-1 text-xs text-primary-500">
              Agent profile config.yaml not accessible. Check the agent&apos;s profile directory.
            </p>
          </div>
        )}
      </div>

      {/* Controls Section */}
      <div className="rounded-2xl border border-primary-200 bg-primary-50/80 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-500">
          Gateway Controls
        </h3>

        <div className="flex gap-3 flex-wrap">
          {/* Start Button */}
          <Button
            size="sm"
            variant={liveStatus === 'active' ? 'outline' : 'default'}
            onClick={() => handleControl('start')}
            disabled={isOperating || liveStatus === 'active'}
            className={liveStatus === 'active' ? 'opacity-50' : ''}
          >
            {pendingAction === 'start' && isOperating ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                Starting…
              </span>
            ) : (
              '▶ Start'
            )}
          </Button>

          {/* Stop Button */}
          <Button
            size="sm"
            variant={liveStatus === 'inactive' ? 'outline' : 'destructive'}
            onClick={() => handleControl('stop')}
            disabled={isOperating || liveStatus === 'inactive'}
            className={liveStatus === 'inactive' ? 'opacity-50' : ''}
          >
            {pendingAction === 'stop' && isOperating ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Stopping…
              </span>
            ) : (
              '■ Stop'
            )}
          </Button>

          {/* Restart Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleControl('restart')}
            disabled={isOperating || liveStatus === 'inactive'}
            className={liveStatus === 'inactive' ? 'opacity-50' : ''}
          >
            {pendingAction === 'restart' && isOperating ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                Restarting…
              </span>
            ) : (
              '↻ Restart'
            )}
          </Button>
        </div>

        <p className="mt-3 text-[10px] text-primary-400">
          Actions are executed via the canonical restart-agent script. Confirm before executing.
        </p>
      </div>

      {/* Confirmation Dialog */}
      <DialogRoot
        open={confirmOpen}
        onOpenChange={(open) => { if (!open) { setConfirmOpen(false); setPendingAction(null) } }}
      >
        <DialogContent>
          <div className="p-5 space-y-3">
            <DialogTitle>
              {actionLabel[pendingAction || 'restart'] || 'Control'} gateway?
            </DialogTitle>
            <DialogDescription>
              {pendingAction ? actionDescription[pendingAction] : ''}
            </DialogDescription>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmAction}
                disabled={!pendingAction || isOperating}
                variant={(pendingAction === 'stop') ? 'destructive' : 'default'}
              >
                {isOperating ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                    Working…
                  </span>
                ) : (
                  actionLabel[pendingAction || 'restart'] || 'Confirm'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  )
}
