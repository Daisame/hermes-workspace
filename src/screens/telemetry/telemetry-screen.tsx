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
  Tooltip,
  ReferenceLine,
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
const CHART_HEIGHT = 80       // px per chart row
const OFFLINE_THRESHOLD_MS = 5000  // 5s gap → mark offline

// Static scale bounds per metric — used in fixed mode
const STATIC_DOMAINS: Record<string, [number, number]> = {
  gpu_util:  [0, 100],
  cpu:       [0, 100],
  temp:      [0, 90],    // throttle threshold
  // power and vram have machine-specific bounds set at render time
}

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
  // Device identity
  host: string | null
  gpu_name: string | null
  layers_cpu: number | null
  cpu_split: boolean | null
  // Inference
  generation_tps: number | null
  prefill_tps: number | null
  total_time_ms: number | null
  total_tokens: number | null
  // Hardware
  gpu_temp_c: number | null
  vram_used_mb: number | null
  vram_total_mb: number | null
  gpu_util_pct: number | null
  power_draw_w: number | null
  cpu_utilization_pct: number | null
  system_ram_used_mb: number | null
  // Model
  model_name: string | null
  quantization: string | null
  n_ctx: number | null
  kv_cache_location: string | null
  kv_vram_mib: number | null
  kv_ram_mib: number | null
  kv_k_quant: string | null
  kv_v_quant: string | null
  server_version: string | null
  // Gate
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

function MachineSection({ machine, data, isOffline, staticScale }: {
  machine: MachineKey
  data: MachineData
  isOffline?: boolean
  staticScale: boolean
}) {
  const cfg = MACHINE_CONFIG[machine]
  const latest = (arr: TelemetryPoint[]) => arr.length ? arr.at(-1)!.value : 0
  // Machine-specific power cap and VRAM total for static scaling
  const powerCap = machine === 'locus' ? 300 : 600   // 3090Ti cap / 5090 TDP headroom
  const vramTotal = data.vram_total ?? (machine === 'locus' ? 24576 : 32768)

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
        <ChartRow label="GPU Util" unit="%" data={data.gpu_util} color="#8b5cf6"
          domain={staticScale ? STATIC_DOMAINS.gpu_util : undefined} />
        <ChartRow label="VRAM" unit=" GB" data={data.vram_used} color="#06b6d4"
          format={(v) => (v / 1024).toFixed(1)}
          domain={staticScale ? [0, vramTotal] : undefined}
          refLine={staticScale ? vramTotal : undefined}
          refLabel="total" />
        <ChartRow label="Temp" unit="°C" data={data.temp} color="#f59e0b"
          domain={staticScale ? STATIC_DOMAINS.temp : undefined}
          refLine={staticScale ? 90 : undefined}
          refLabel="throttle" />
        <ChartRow label="Power" unit=" W" data={data.power} color="#ef4444"
          domain={staticScale ? [0, powerCap] : undefined}
          refLine={staticScale ? powerCap : undefined}
          refLabel="cap" />
        <ChartRow label="CPU" unit="%" data={data.cpu} color="#10b981"
          domain={staticScale ? STATIC_DOMAINS.cpu : undefined} />
      </div>
    </div>
  )
}

// Custom tooltip for recharts — shows the exact value at the hovered point
function ChartTooltip({ active, payload, unit, format }: {
  active?: boolean
  payload?: Array<{ value: number }>
  unit: string
  format?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  const display = format ? format(v) + unit : v.toFixed(1) + unit
  return (
    <div className="rounded border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1 text-[10px] tabular-nums shadow-lg">
      {display}
    </div>
  )
}

function ChartRow({ label, unit, data, color, format, domain, refLine, refLabel }: {
  label: string
  unit: string
  data: TelemetryPoint[]
  color: string
  format?: (v: number) => string
  domain?: [number, number]
  refLine?: number
  refLabel?: string
}) {
  const latestVal = data.length ? data.at(-1)!.value : null
  const display = latestVal != null
    ? (format ? format(latestVal) + unit : latestVal.toFixed(1) + unit)
    : '—'

  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-[var(--theme-muted)]">
        <span>{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="ts" hide />
          <YAxis domain={domain ?? [0, 'auto']} hide width={0} />
          <Tooltip
            content={<ChartTooltip unit={unit} format={format} />}
            cursor={{ stroke: '#ffffff20', strokeWidth: 1 }}
          />
          {refLine != null && (
            <ReferenceLine
              y={refLine}
              stroke="#ffffff25"
              strokeDasharray="3 3"
              label={{ value: refLabel, position: 'insideTopRight', fontSize: 8, fill: '#ffffff40' }}
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

  // Auto-refresh every 30s so new runs appear without page reload
  useEffect(() => {
    const id = setInterval(fetchRuns, 30_000)
    return () => clearInterval(id)
  }, [fetchRuns])

  const toggleExpand = (runId: string) => {
    setExpanded(prev => prev === runId ? null : runId)
  }

  if (loading) return <div className="text-xs text-[var(--theme-muted)] px-1 py-2">Loading history…</div>
  if (runs.length === 0) return <div className="text-xs text-[var(--theme-muted)] px-1 py-2">No pipeline runs recorded yet.</div>

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-2.5">
        <HugeiconsIcon icon={Activity01Icon} size={14} className="text-[var(--theme-muted)]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">Run History</span>
      </div>

      {/* Column headers */}
      <div className="grid px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--theme-muted)] border-b border-[var(--theme-border)]"
           style={{ gridTemplateColumns: '1fr 7rem 4rem 3.5rem' }}>
        <div>Run ID</div>
        <div>Started</div>
        <div>Stages</div>
        <div className="text-right">Gate</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[var(--theme-border)]">
        {runs.map(run => {
          const isExpanded = expanded === run.run_id
          const lastStageWithOutcome = [...run.stages].reverse().find(s => s.outcome)
          const gateOutcome = lastStageWithOutcome?.outcome ?? null
          const stageNames = run.stages.map(s => s.name).join(', ')

          return (
            <div key={run.run_id}>
              {/* Run row */}
              <button
                onClick={() => toggleExpand(run.run_id)}
                className="w-full grid items-center px-4 py-2 text-left text-xs transition-colors hover:bg-[var(--theme-hover)]"
                style={{ gridTemplateColumns: '1fr 7rem 4rem 3.5rem' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <HugeiconsIcon
                    icon={isExpanded ? ChevronDown : ChevronRight}
                    size={12}
                    className="shrink-0 text-[var(--theme-muted)]"
                  />
                  <span className="font-mono truncate">{run.run_id}</span>
                  {stageNames && (
                    <span className="hidden sm:inline text-[var(--theme-muted)] truncate text-[10px]">
                      · {stageNames}
                    </span>
                  )}
                </div>
                <div className="tabular-nums text-[var(--theme-muted)]">{formatStartedAt(run.started_at)}</div>
                <div className="tabular-nums text-[var(--theme-muted)]">{run.stages_completed}</div>
                <div className="flex justify-end">
                  <OutcomeBadge outcome={gateOutcome} />
                </div>
              </button>

              {/* Expanded stage rows */}
              {isExpanded && (
                <div className="border-t border-[var(--theme-border)] bg-[var(--theme-hover)]/30">
                  {/* Sub-header — same 4-col grid as parent row so columns align */}
                  <div className="grid px-4 py-1 text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                       style={{ gridTemplateColumns: '1fr 7rem 4rem 3.5rem' }}>
                    <div className="pl-5">Stage</div>
                    <div>Duration</div>
                    <div>Confidence</div>
                    <div className="text-right">Gate</div>
                  </div>
                  {run.stages.map(stage => (
                    <button
                      key={stage.name}
                      onClick={() => onSelectStage(run.run_id, stage.name)}
                      className="w-full grid items-center px-4 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-hover)]"
                      style={{ gridTemplateColumns: '1fr 7rem 4rem 3.5rem' }}
                    >
                      <div className="pl-5 font-medium truncate">{stage.name}</div>
                      <div className="tabular-nums text-[var(--theme-muted)]">{formatDuration(stage.duration_s)}</div>
                      <div className="tabular-nums text-[var(--theme-muted)]">
                        {stage.confidence != null ? (() => {
                          const m = stage.confidence - 0.5
                          return `${fmt(stage.confidence, 2)} (${m >= 0 ? '+' : ''}${fmt(m, 2)})`
                        })() : '—'}
                      </div>
                      <div className="flex justify-end"><OutcomeBadge outcome={stage.outcome} /></div>
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
  const hasInference = detail.generation_tps != null || detail.prefill_tps != null || detail.total_time_ms != null
  const hasHardware = detail.gpu_temp_c != null || detail.vram_used_mb != null || detail.gpu_util_pct != null
  const hasModelDetail = detail.quantization != null || detail.n_ctx != null || detail.kv_cache_location != null

  // CPU split tag: true = GPU+CPU, false = GPU only, null = unknown
  const splitTag = detail.cpu_split === true
    ? { label: 'GPU + CPU', cls: 'bg-amber-500/15 text-amber-400' }
    : detail.cpu_split === false
      ? { label: 'GPU only', cls: 'bg-emerald-500/15 text-emerald-400' }
      : null

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-[var(--theme-muted)] shrink-0">{detail.run_id}</span>
          <span className="text-[var(--theme-muted)]">/</span>
          <span className="text-xs font-medium truncate">{detail.stage_name}</span>
          {detail.outcome && <OutcomeBadge outcome={detail.outcome} />}
          {detail.confidence != null && (
            <span className="text-[10px] tabular-nums text-[var(--theme-muted)]">
              {(() => { const m = detail.confidence - 0.5; return `${fmt(detail.confidence, 2)} (${m >= 0 ? '+' : ''}${fmt(m, 2)})` })()}
            </span>
          )}
          {detail.duration_s != null && (
            <span className="text-[10px] tabular-nums text-[var(--theme-muted)]">· {formatDuration(detail.duration_s)}</span>
          )}
        </div>
        <button onClick={onClose} className="ml-4 shrink-0 rounded p-1 hover:bg-[var(--theme-hover)]" aria-label="Close">
          <HugeiconsIcon icon={Close} size={14} className="text-[var(--theme-muted)]" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* Row 1 — Model + device identity (full width), each item labelled */}
        {(detail.model_name || detail.host || detail.gpu_name) && (
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            {detail.model_name && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Model</span>
                <span className="font-mono text-xs font-semibold">{detail.model_name}</span>
              </div>
            )}
            {detail.quantization && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Quantization</span>
                <span className="font-mono text-xs">{detail.quantization.toUpperCase()}</span>
              </div>
            )}
            {detail.n_ctx != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Context</span>
                <span className="text-xs tabular-nums">{(detail.n_ctx / 1024).toFixed(0)}K</span>
              </div>
            )}
            {detail.host && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Server</span>
                <span className="text-xs">{detail.host}</span>
              </div>
            )}
            {detail.gpu_name && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">GPU</span>
                <span className="text-xs">{detail.gpu_name}</span>
              </div>
            )}
            {(() => {
              // KV cache: show exact VRAM/RAM split if available, else location string
              const vram = detail.kv_vram_mib
              const ram  = detail.kv_ram_mib
              const loc  = detail.kv_cache_location
              if (vram == null && ram == null && !loc) return null
              let label = '—'
              let tag: { text: string; cls: string } | null = null
              if (vram != null && ram != null && ram > 0) {
                const total = vram + ram
                label = `${(vram/1024).toFixed(1)}/${(ram/1024).toFixed(1)} GB VRAM/RAM`
                tag = { text: 'Split', cls: 'bg-amber-500/15 text-amber-400' }
              } else if (vram != null && vram > 0) {
                label = `${(vram/1024).toFixed(1)} GB VRAM`
                tag = { text: 'GPU', cls: 'bg-emerald-500/15 text-emerald-400' }
              } else if (ram != null && ram > 0) {
                label = `${(ram/1024).toFixed(1)} GB RAM`
                tag = { text: 'CPU', cls: 'bg-amber-500/15 text-amber-400' }
              } else if (loc) {
                label = loc
              }
              return (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">KV Cache</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs tabular-nums">{label}</span>
                    {tag && <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${tag.cls}`}>{tag.text}</span>}
                  </div>
                </div>
              )
            })()}
            {detail.server_version && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Engine</span>
                <span className="text-xs font-mono">llama.cpp {detail.server_version}</span>
              </div>
            )}
            {splitTag && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--theme-muted)]">Compute</span>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${splitTag.cls}`}>{splitTag.label}</span>
              </div>
            )}
          </div>
        )}

        {/* Row 2 — Inference + Hardware side by side */}
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <Section title="Inference Metrics">
            {hasInference ? (
              <>
                {detail.generation_tps != null && <MetricRow label="Generation TPS" value={fmt(detail.generation_tps, 2)} />}
                {detail.prefill_tps != null && <MetricRow label="Prefill TPS" value={fmt(detail.prefill_tps, 2)} />}
                {detail.total_time_ms != null && <MetricRow label="Total Time" value={`${(detail.total_time_ms / 1000).toFixed(1)}s`} />}
                {detail.total_tokens != null && <MetricRow label="Total Tokens" value={detail.total_tokens.toLocaleString()} />}
              </>
            ) : (
              <p className="text-[10px] text-[var(--theme-muted)] italic">Not recorded — run pipeline to capture</p>
            )}
          </Section>

          <Section title="Hardware at Completion">
            {hasHardware ? (
              <>
                {detail.gpu_temp_c != null && <MetricRow label="GPU Temp" value={`${fmt(detail.gpu_temp_c, 0)}°C`} />}
                {(detail.vram_used_mb != null && detail.vram_total_mb != null) && (
                  <MetricRow label="VRAM" value={`${(detail.vram_used_mb/1024).toFixed(1)} / ${(detail.vram_total_mb/1024).toFixed(1)} GB`} />
                )}
                {detail.gpu_util_pct != null && <MetricRow label="GPU Util" value={`${fmt(detail.gpu_util_pct, 0)}%`} />}
                {detail.power_draw_w != null && <MetricRow label="Power" value={`${fmt(detail.power_draw_w)}W`} />}
                {detail.cpu_utilization_pct != null && <MetricRow label="CPU Util" value={`${fmt(detail.cpu_utilization_pct, 0)}%`} />}
              </>
            ) : (
              <p className="text-[10px] text-[var(--theme-muted)] italic">Not recorded — run pipeline to capture</p>
            )}
          </Section>
        </div>
      </div>

      {/* Issues — full width, below */}
      {detail.issues && detail.issues.length > 0 && (
        <div className="border-t border-[var(--theme-border)] px-4 py-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-400">Issues</h3>
          <ul className="space-y-1">
            {detail.issues.map((issue, i) => (
              <li key={i} className="rounded bg-red-500/10 px-3 py-1.5 text-xs text-red-300">{issue}</li>
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
  const [staticScale, setStaticScale] = useState(false)
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
        <div className="flex items-center gap-3">
          {/* Static / Dynamic scale toggle */}
          <button
            onClick={() => setStaticScale(s => !s)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors ${
              staticScale
                ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
                : 'bg-[var(--theme-hover)] text-[var(--theme-muted)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${staticScale ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-muted)]'}`} />
            {staticScale ? 'Fixed scale' : 'Auto scale'}
          </button>
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
            connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {connected ? 'Live' : 'Connecting…'}
          </div>
        </div>
      </div>

      {/* Panel 1 — Machine cards — side by side */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MachineSection machine="locus" data={locusData} isOffline={offlineMachines.has('locus')} staticScale={staticScale} />
        <MachineSection machine="gamepc" data={gamepcData} isOffline={offlineMachines.has('gamepc')} staticScale={staticScale} />
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
