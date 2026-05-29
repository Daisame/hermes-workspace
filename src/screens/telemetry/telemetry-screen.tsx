'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Activity01Icon, CpuIcon, ServerStackIcon, ChevronDown, ChevronRight, Close } from '@hugeicons/core-free-icons'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TelemetryPoint {
  ts: number
  value: number
}

type MachineKey = 'locus' | 'gamepc'

const MACHINE_CONFIG: Record<MachineKey, { label: string; icon: typeof Activity01Icon }> = {
  locus:   { label: 'Locus',   icon: ServerStackIcon },
  gamepc:  { label: 'GamePC',  icon: CpuIcon },
}

const MAX_POINTS = 60          // rolling window (~30s at 500ms)
const CHART_HEIGHT = 120      // px per chart row
const OFFLINE_THRESHOLD_MS = 5000  // 5s gap → mark offline

/* ------------------------------------------------------------------ */
/*  Run History Types                                                  */
/* ------------------------------------------------------------------ */

interface StageInfo {
  name: string
  ts: string | null
  duration_s: number | null
  outcome: 'pass' | 'fail' | null
  confidence: number | null
  issues?: string[]
}

interface RunSummary {
  run_id: string
  started_at: string
  stages_completed: number
  last_stage_ts: string | null
  stages: StageInfo[]
}

/* ------------------------------------------------------------------ */
/*  Stage Detail Types                                                 */
/* ------------------------------------------------------------------ */

interface StageDetail {
  run_id: string
  stage_name: string
  generation_tps: number | null
  prefill_tps: number | null
  total_time_ms: number | null
  total_tokens: number | null
  gpu_temp_c: number | null
  vram_used_mb: number | null
  vram_total_mb: number | null
  gpu_util_pct: number | null
  power_draw_w: number | null
  cpu_utilization_pct: number | null
  system_ram_used_mb: number | null
  model_name: string | null
  quantization: string | null
  n_ctx: number | null
  kv_cache_location: string | null
  kv_k_quant: string | null
  kv_v_quant: string | null
  server_version: string | null
  outcome: 'pass' | 'fail' | null
  confidence: number | null
  duration_s: number | null
  issues?: string[]
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse a single SSE data line emitted by telemetry-stream.ts proxy.
    The proxy double-wraps: event:data → "data: {json}"
    We strip the outer wrapper and parse the inner JSON payload. */
function parseTelemetryLine(raw: string): { machine: MachineKey; metrics: Record<string, number> } | null {
  try {
    let inner: string = raw
    try {
      const unwrapped = JSON.parse(raw)
      if (typeof unwrapped === 'string') inner = unwrapped
    } catch {
      // raw was not a JSON string — use as-is
    }
    const cleaned = inner.replace(/^\s*data:\s*/i, '').trim()
    const parsed = JSON.parse(cleaned)
    const machine = parsed.machine as MachineKey | undefined
    if (!machine || !(machine in MACHINE_CONFIG)) return null
    const metrics: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (k === 'machine' || k === 'ts') continue
      if (typeof v === 'number') metrics[k] = v
    }
    return { machine, metrics }
  } catch {
    return null
  }
}

function pushPoint(history: TelemetryPoint[], value: number): TelemetryPoint[] {
  const next = [...history, { ts: Date.now(), value }]
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}

/** Format duration in seconds to human-readable string */
function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/** Format timestamp to human-readable relative string */
function formatStartedAt(ts: string): string {
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ts
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return `Today ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return `${d.toLocaleDateString()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return ts
  }
}

/** Format number with optional decimals */
function fmt(v: number | null, decimals = 1): string {
  if (v == null) return '—'
  return v.toFixed(decimals)
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface MachineData {
  gpu_util:   TelemetryPoint[]
  vram_used:  TelemetryPoint[]
  vram_total: number | null
  temp:       TelemetryPoint[]
  power:      TelemetryPoint[]
  cpu:        TelemetryPoint[]
}

function emptyMachineData(): MachineData {
  return { gpu_util: [], vram_used: [], vram_total: null, temp: [], power: [], cpu: [] }
}

function MachineSection({ machine, data, isOffline }: { machine: MachineKey; data: MachineData; isOffline?: boolean }) {
  const cfg = MACHINE_CONFIG[machine]
  const latest = (arr: TelemetryPoint[]) => arr.length ? arr.at(-1)!.value : 0

  return (
    <div className={`rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 transition-opacity ${isOffline ? 'opacity-40' : ''}`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={cfg.icon} size={20} className="text-[var(--theme-muted)]" />
          <span className="text-sm font-medium">{cfg.label}</span>
          {isOffline && (
            <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">OFFLINE</span>
          )}
        </div>
        <div className="flex gap-4 text-xs tabular-nums text-[var(--theme-muted)]">
          <span>GPU {latest(data.gpu_util).toFixed(0)}%</span>
          <span>VRAM {(latest(data.vram_used) / 1024).toFixed(1)} GB</span>
          <span>{latest(data.temp).toFixed(0)}°C</span>
          <span>{latest(data.power).toFixed(0)} W</span>
          <span>CPU {latest(data.cpu).toFixed(0)}%</span>
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-2">
        <ChartRow label="GPU Util %" data={data.gpu_util} color="#8b5cf6" />
        <ChartRow label="VRAM GB" data={data.vram_used} color="#06b6d4"
          format={(v) => (v / 1024).toFixed(1)}
          referenceLine={data.vram_total ? data.vram_total / 1024 : null} />
        <ChartRow label="GPU Temp °C" data={data.temp} color="#f59e0b" />
        <ChartRow label="Power W" data={data.power} color="#ef4444" />
        <ChartRow label="CPU %" data={data.cpu} color="#10b981" />
      </div>
    </div>
  )
}

function ChartRow({ label, data, color, format, referenceLine }: {
  label: string
  data: TelemetryPoint[]
  color: string
  format?: (v: number) => string
  referenceLine?: number | null
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-[var(--theme-muted)]">
        <span>{label}</span>
        <span>{data.length ? (format ?? ((v: number) => v.toFixed(0)))(data.at(-1)!.value) : '—'}</span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="ts" hide />
          <YAxis domain={[0, 'auto']} hide width={0} />
          {referenceLine != null && (
            <Area
              type="monotone"
              dataKey={() => referenceLine}
              stroke="#ffffff30"
              fill="none"
              strokeWidth={1}
              strokeDasharray="4 4"
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel 2 — Run History Table                                       */
/* ------------------------------------------------------------------ */

function OutcomeBadge({ outcome }: { outcome: 'pass' | 'fail' | null | undefined }) {
  if (!outcome) return <span className="text-[var(--theme-muted)]">—</span>
  const cls = outcome === 'pass'
    ? 'bg-emerald-500/15 text-emerald-400'
    : 'bg-red-500/15 text-red-400'
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{outcome.toUpperCase()}</span>
}

function RunHistoryTable({ onSelectStage }: { onSelectStage: (runId: string, stageName: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry/runs')
      if (res.ok) setRuns(await res.json())
    } catch (err) {
      console.error('Failed to fetch runs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  const toggleExpand = (runId: string) => {
    setExpanded(prev => prev === runId ? null : runId)
  }

  if (loading) return <div className="text-xs text-[var(--theme-muted)]">Loading history…</div>
  if (runs.length === 0) return <div className="text-xs text-[var(--theme-muted)]">No pipeline runs recorded yet.</div>

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <HugeiconsIcon icon={Activity01Icon} size={16} className="text-[var(--theme-muted)]" />
        Run History
      </h2>

      {/* Table header */}
      <div className="mb-2 grid grid-cols-12 gap-2 border-b border-[var(--theme-border)] pb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--theme-muted)]">
        <div className="col-span-4">Run ID</div>
        <div className="col-span-3">Started</div>
        <div className="col-span-3">Stages</div>
        <div className="col-span-2 text-center">Gate</div>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {runs.map(run => {
          const isExpanded = expanded === run.run_id
          // Determine overall gate outcome (last stage with outcome)
          const lastStageWithOutcome = [...run.stages].reverse().find(s => s.outcome)
          const gateOutcome = lastStageWithOutcome?.outcome ?? null

          return (
            <div key={run.run_id} className="group">
              {/* Run row */}
              <button
                onClick={() => toggleExpand(run.run_id)}
                className="w-full grid grid-cols-12 gap-2 rounded px-2 py-2 text-left text-xs transition-colors hover:bg-[var(--theme-hover)]"
              >
                <div className="col-span-4 font-mono truncate">{run.run_id}</div>
                <div className="col-span-3 tabular-nums text-[var(--theme-muted)]">{formatStartedAt(run.started_at)}</div>
                <div className="col-span-3 tabular-nums text-[var(--theme-muted)]">{run.stages_completed}</div>
                <div className="col-span-2 flex justify-center">
                  <OutcomeBadge outcome={gateOutcome} />
                </div>
              </button>

              {/* Expanded stages */}
              {isExpanded && (
                <div className="ml-4 mt-1 border-l-2 border-[var(--theme-border)] pl-3 space-y-1">
                  {run.stages.map(stage => (
                    <button
                      key={stage.name}
                      onClick={() => onSelectStage(run.run_id, stage.name)}
                      className="w-full grid grid-cols-12 gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-hover)]"
                    >
                      <div className="col-span-4 font-medium truncate">{stage.name}</div>
                      <div className="col-span-3 tabular-nums text-[var(--theme-muted)]">{formatDuration(stage.duration_s)}</div>
                      <div className="col-span-2">
                        <OutcomeBadge outcome={stage.outcome} />
                      </div>
                      <div className="col-span-3 tabular-nums text-[var(--theme-muted)]">
                        {stage.confidence != null ? (() => {
                          const m = stage.confidence - 0.5
                          return `${fmt(stage.confidence, 2)} (${m >= 0 ? '+' : ''}${fmt(m, 2)})`
                        })() : '—'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel 3 — Stage Detail                                            */
/* ------------------------------------------------------------------ */

function MetricRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[var(--theme-muted)]">{label}</span>
      <span className="tabular-nums font-mono">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function StageDetailPanel({ detail, onClose }: { detail: StageDetail; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <span className="font-mono">{detail.run_id}</span>
            <span className="text-[var(--theme-muted)]">/</span>
            <span>{detail.stage_name}</span>
          </h2>
        </div>
        <button onClick={onClose} className="rounded p-1 hover:bg-[var(--theme-hover)]" aria-label="Close">
          <HugeiconsIcon icon={Close} size={16} className="text-[var(--theme-muted)]" />
        </button>
      </div>

      {/* Sections */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Inference Metrics">
          <MetricRow label="Generation TPS" value={fmt(detail.generation_tps, 2)} />
          <MetricRow label="Prefill TPS" value={fmt(detail.prefill_tps, 2)} />
          <MetricRow label="Total Time" value={detail.total_time_ms != null ? `${(detail.total_time_ms / 1000).toFixed(1)}s` : '—'} />
          <MetricRow label="Total Tokens" value={detail.total_tokens?.toLocaleString() ?? '—'} />
        </Section>

        <Section title="Hardware at Completion">
          <MetricRow label="GPU Temp °C" value={fmt(detail.gpu_temp_c, 0)} />
          <MetricRow label="VRAM Used / Total" value={(() => {
            if (detail.vram_used_mb == null || detail.vram_total_mb == null) return '—'
            return `${(detail.vram_used_mb / 1024).toFixed(1)} / ${(detail.vram_total_mb / 1024).toFixed(1)} GB`
          })()} />
          <MetricRow label="GPU Util %" value={fmt(detail.gpu_util_pct, 0)} />
          <MetricRow label="Power Draw W" value={fmt(detail.power_draw_w)} />
          <MetricRow label="CPU Util %" value={fmt(detail.cpu_utilization_pct, 0)} />
        </Section>

        <Section title="Model Config">
          <MetricRow label="Model" value={detail.model_name ?? '—'} />
          <MetricRow label="Quantization" value={detail.quantization ?? '—'} />
          <MetricRow label="Context Window" value={detail.n_ctx?.toLocaleString() ?? '—'} />
          <MetricRow label="KV Cache" value={detail.kv_cache_location ?? '—'} />
          <MetricRow label="Server Version" value={detail.server_version ?? '—'} />
        </Section>

        <Section title="Pipeline Gate">
          <MetricRow label="Outcome" value={<OutcomeBadge outcome={detail.outcome} />} />
          <MetricRow label="Confidence" value={fmt(detail.confidence, 3)} />
          <MetricRow label="Duration" value={formatDuration(detail.duration_s)} />
        </Section>
      </div>

      {/* Issues list — only shown on failure */}
      {detail.issues && detail.issues.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">Issues</h3>
          <ul className="space-y-1">
            {detail.issues.map((issue, i) => (
              <li key={i} className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-300">{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Screen — single EventSource, fan out to both machine sections     */
/* ------------------------------------------------------------------ */

export function TelemetryScreen() {
  const [connected, setConnected] = useState(false)
  const machineRef = useRef<Record<string, MachineData>>({
    locus:   emptyMachineData(),
    gamepc:  emptyMachineData(),
  })

  // Offline detection — track last seen timestamp per machine
  const lastSeenRef = useRef<Record<string, number>>({})
  const [offlineMachines, setOfflineMachines] = useState<Set<string>>(new Set())

  // Force re-render on new data — bump counter instead of deep-state
  const [, bump] = useState(0)

  // Stage detail panel state
  const [stageDetail, setStageDetail] = useState<StageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const ev = new EventSource('/api/telemetry-stream')
    ev.onopen     = () => setConnected(true)
    ev.onerror    = () => setConnected(false)

    const onMessage = (e: MessageEvent) => {
      const parsed = parseTelemetryLine(e.data)
      if (!parsed) return

      const { machine, metrics } = parsed
      
      // Update last seen timestamp
      lastSeenRef.current[machine] = Date.now()

      const bucket = machineRef.current[machine] ?? emptyMachineData()

      if ('gpu_util_pct' in metrics)  bucket.gpu_util   = pushPoint(bucket.gpu_util,   metrics.gpu_util_pct)
      if ('vram_used_mb' in metrics)  bucket.vram_used  = pushPoint(bucket.vram_used,  metrics.vram_used_mb)
      if ('vram_total_mb' in metrics) bucket.vram_total = metrics.vram_total_mb
      if ('gpu_temp_c' in metrics)    bucket.temp       = pushPoint(bucket.temp,       metrics.gpu_temp_c)
      if ('power_draw_w' in metrics)  bucket.power      = pushPoint(bucket.power,      metrics.power_draw_w)
      if ('cpu_util_pct' in metrics)  bucket.cpu        = pushPoint(bucket.cpu,        metrics.cpu_util_pct)

      machineRef.current[machine] = bucket
      bump(n => n + 1)
    }

    ev.addEventListener('data', onMessage)
    return () => { ev.close() }
  }, [])

  // Offline detection interval — check every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const offline = new Set<string>()
      
      for (const machine of ['locus', 'gamepc']) {
        const last = lastSeenRef.current[machine] ?? 0
        if (now - last > OFFLINE_THRESHOLD_MS) {
          offline.add(machine)
        }
      }

      setOfflineMachines(prev => {
        // Only re-render if the set changed
        if (prev.size === offline.size && [...offline].every(m => prev.has(m))) return prev
        return offline
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const locusData   = machineRef.current.locus   ?? emptyMachineData()
  const gamepcData  = machineRef.current.gamepc  ?? emptyMachineData()

  // Fetch stage detail when selected
  const handleSelectStage = async (runId: string, stageName: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/telemetry/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageName)}`)
      if (res.ok) {
        const data = await res.json() as StageDetail
        setStageDetail(data)
      } else {
        console.error('Failed to fetch stage detail:', res.status)
      }
    } catch (err) {
      console.error('Stage detail error:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCloseDetail = () => setStageDetail(null)

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 pb-[calc(var(--tabbar-h,80px)+1.5rem)] sm:px-6 lg:px-8">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Activity01Icon} size={24} className="text-[var(--theme-accent)]" />
          <h1 className="text-lg font-semibold">Telemetry</h1>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
          connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {connected ? 'Live' : 'Connecting…'}
        </div>
      </div>

      {/* Panel 1 — Machine cards — side by side */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MachineSection machine="locus" data={locusData} isOffline={offlineMachines.has('locus')} />
        <MachineSection machine="gamepc" data={gamepcData} isOffline={offlineMachines.has('gamepc')} />
      </div>

      {/* Panel 2 — Run History Table */}
      <RunHistoryTable onSelectStage={handleSelectStage} />

      {/* Loading indicator for stage detail */}
      {detailLoading && (
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 text-xs text-[var(--theme-muted)]">
          Loading stage details…
        </div>
      )}

      {/* Panel 3 — Stage Detail */}
      {stageDetail && !detailLoading && (
        <StageDetailPanel detail={stageDetail} onClose={handleCloseDetail} />
      )}
    </div>
  )
}
