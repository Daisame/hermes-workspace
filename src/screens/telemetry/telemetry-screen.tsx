'use client'

import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Activity01Icon, CpuIcon, ServerStackIcon } from '@hugeicons/core-free-icons'
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse a single SSE data line emitted by live_telemetry.py.
    Expected: {"machine":"locus","gpu_util_pct":55,"vram_used_mb":14000,
               "vram_total_mb":24000,"gpu_temp_c":72,"power_draw_w":180,
               "cpu_util_pct":23,"ts":...} */
function parseTelemetryLine(raw: string): { machine: MachineKey; metrics: Record<string, number> } | null {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw))
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

function MachineSection({ machine, data }: { machine: MachineKey; data: MachineData }) {
  const cfg = MACHINE_CONFIG[machine]
  const latest = (arr: TelemetryPoint[]) => arr.length ? arr.at(-1)!.value : 0

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={cfg.icon} size={20} className="text-[var(--theme-muted)]" />
          <span className="text-sm font-medium">{cfg.label}</span>
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
/*  Screen — single EventSource, fan out to both machine sections      */
/* ------------------------------------------------------------------ */

export function TelemetryScreen() {
  const [connected, setConnected] = useState(false)
  const machineRef = useRef<Record<string, MachineData>>({
    locus:   emptyMachineData(),
    gamepc:  emptyMachineData(),
  })

  // Force re-render on new data — bump counter instead of deep-state
  const [, bump] = useState(0)

  useEffect(() => {
    const ev = new EventSource('/api/telemetry-stream')
    ev.onopen     = () => setConnected(true)
    ev.onerror    = () => setConnected(false)

    const onMessage = (e: MessageEvent) => {
      const parsed = parseTelemetryLine(e.data)
      if (!parsed) return

      const { machine, metrics } = parsed
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

  const locusData   = machineRef.current.locus   ?? emptyMachineData()
  const gamepcData  = machineRef.current.gamepc  ?? emptyMachineData()

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

      {/* Machine cards — side by side */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MachineSection machine="locus" data={locusData} />
        <MachineSection machine="gamepc" data={gamepcData} />
      </div>
    </div>
  )
}
