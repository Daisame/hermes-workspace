/**
 * Model Picker Panel — select and save model from LM Studio catalog.
 * Renders as a section inside the Agent Profile dialog.
 */
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDown, InformationCircleFreeIcons } from '@hugeicons/core-free-icons'
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from '@/components/ui/menu'
import { Button } from '@/components/ui/button'
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'

interface ModelEntry {
  id: string
  displayName: string
  state: 'loaded' | 'not-loaded'
  quantization?: string
  maxContextLength: number
  loadedContextLength?: number
  type: string
  publisher?: string
  capabilities?: string[]
}

interface ModelPanelProps {
  agentId: string
  currentModel: string | null
  onDirtyChange?: (isDirty: boolean) => void
}

function formatContextLength(value: number): string {
  if (!value) return '—'
  if (value >= 1024 * 1024) return `${value / 1024 / 1024}M`
  if (value >= 1024) return `${value / 1024}K`
  return String(value)
}

async function fetchModels(): Promise<{ ok: boolean; models: ModelEntry[]; error?: string }> {
  try {
    const res = await fetch('/api/models/list')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : 'Failed to fetch' }
  }
}

async function saveModel(
  profileName: string,
  modelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/profiles/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: profileName,
      patch: { model: { default: modelId } },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }

  return await res.json()
}

export function ModelPanel({ agentId, currentModel, onDirtyChange }: ModelPanelProps) {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(currentModel ?? '')
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Find the model currently loaded by LM Studio (what's actually running)
  const loadedModelId = models.find((m) => m.state === 'loaded')?.id ?? null

  // Dirty state: saved config differs from what LM Studio has actually loaded.
  // This persists after save until a gateway restart picks up the new model.
  const isDirty = currentModel !== null && loadedModelId !== null && currentModel !== loadedModelId

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Sync selected when currentModel changes externally (e.g., after save)
  useEffect(() => {
    setSelectedModel(currentModel ?? '')
  }, [currentModel])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (cancelled) return
      setLoading(true)
      setFetchError(null)
      fetchModels().then((data) => {
        if (!cancelled) {
          if (data.ok) {
            setModels(data.models)
          } else {
            setFetchError(data.error ?? 'Failed to load models')
          }
          setLoading(false)
        }
      })
    }

    load()
  }, [])

  const loadedModels = models.filter((m) => m.state === 'loaded')
  const notLoadedModels = models.filter((m) => m.state !== 'loaded')

  async function handleSave() {
    if (!selectedModel || isSaving) return
    setIsSaving(true)
    try {
      const result = await saveModel(agentId.toLowerCase(), selectedModel)
      if (result.ok) {
        toast(`Model changed to ${selectedModel}`, { type: 'success' })
      } else {
        throw new Error(result.error ?? 'Save failed')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to save model', { type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const selectedModelData = models.find((m) => m.id === selectedModel)

  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-500 dark:text-neutral-400">
        Model Selection
      </h3>

      {fetchError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          {fetchError} — models may not be available if LM Studio is offline.
        </div>
      )}

      {/* Current model info */}
      {!loading && selectedModelData && (
        <div className="mb-3 rounded-xl border border-primary-100 bg-primary-100/60 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
          <p className="text-xs font-medium text-primary-900 dark:text-neutral-200">
            {selectedModelData.displayName}
          </p>
          <div className="mt-1 flex gap-3 text-[10px] text-primary-400 dark:text-neutral-500">
            <span>ID: <code className="text-[9px]">{selectedModelData.id}</code></span>
            {selectedModelData.quantization && <span>Quant: {selectedModelData.quantization}</span>}
            <span>Context: {formatContextLength(selectedModelData.maxContextLength)}</span>
            <span className={selectedModelData.state === 'loaded' ? 'text-emerald-500' : ''}>
              {selectedModelData.state === 'loaded' ? '● Loaded' : '○ Not loaded'}
            </span>
          </div>
        </div>
      )}

      {/* Model selector */}
      <div className="space-y-2">
        <label className="text-xs text-primary-500 dark:text-neutral-400">Select model</label>

        {loading ? (
          <div className="h-9 rounded-xl border border-primary-200 bg-primary-50 px-3 text-sm text-primary-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
            Loading models…
          </div>
        ) : (
          <MenuRoot>
            <MenuTrigger asChild>
              <button
                type="button"
                disabled={isSaving || models.length === 0}
                className="h-9 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 pr-8 text-sm text-primary-900 outline-none transition focus:border-primary-500 focus:ring-[3px] focus:ring-primary-500/24 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              >
                {models.find((m) => m.id === selectedModel)?.displayName || 'Select a model'}
                <HugeiconsIcon icon={ChevronDown} size={16} className="pointer-events-none absolute right-2 top-2.5 text-primary-400 dark:text-neutral-500" />
              </button>
            </MenuTrigger>
            <MenuContent side="bottom" align="start" className="min-w-(--anchor-width) max-h-[300px] overflow-y-auto">
              {loadedModels.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
                    Currently loaded
                  </div>
                  {loadedModels.map((model) => (
                    <MenuItem
                      key={model.id}
                      style={{ fontWeight: model.id === selectedModel ? 600 : 450 }}
                      onClick={() => setSelectedModel(model.id)}
                    >
                      <span className="truncate">{model.displayName}</span>
                      {model.quantization && (
                        <span className="ml-auto text-[10px] opacity-50">{model.quantization}</span>
                      )}
                    </MenuItem>
                  ))}
                </>
              )}

              {notLoadedModels.length > 0 && (
                <>
                  {loadedModels.length > 0 && <div className="h-px bg-primary-200 dark:bg-neutral-700" />}
                  {loadedModels.length === 0 && (
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-400">
                      Available models
                    </div>
                  )}
                  {notLoadedModels.map((model) => (
                    <MenuItem
                      key={model.id}
                      style={{ fontWeight: model.id === selectedModel ? 600 : 450 }}
                      onClick={() => setSelectedModel(model.id)}
                    >
                      <span className="truncate">{model.displayName}</span>
                      {model.quantization && (
                        <span className="ml-auto text-[10px] opacity-50">{model.quantization}</span>
                      )}
                    </MenuItem>
                  ))}
                </>
              )}

              {models.length === 0 && (
                <div className="px-3 py-2 text-xs text-primary-400 dark:text-neutral-500">
                  No models available
                </div>
              )}
            </MenuContent>
          </MenuRoot>
        )}
      </div>

      {/* Save button with dirty state */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={!selectedModel || selectedModel === currentModel || isSaving}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save model change'}
        </Button>

        {/* Dirty-state indicator: shows when saved config differs from what LM Studio has loaded */}
        {isDirty && (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <HugeiconsIcon icon={InformationCircleFreeIcons} size={12} />
                  Restart required — config change not yet live
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px] whitespace-normal leading-relaxed">
                The saved model won&apos;t take effect until the gateway is restarted. Use the Gateway panel to restart when ready.
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        )}
      </div>

      {/* Note about local vs remote models */}
      <p className="mt-2 text-[10px] text-primary-300 dark:text-neutral-600">
        Models sourced from gaming PC LM Studio. All listed models are accessible via the same endpoint regardless of physical location.
      </p>
    </div>
  )
}
