/**
 * Voice Management Panel — ElevenLabs pull + ffprobe metadata display.
 * Renders as a tab inside the Agent Profile page.
 */
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDown, InformationCircleFreeIcons } from '@hugeicons/core-free-icons'
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from '@/components/ui/menu'
import { Autocomplete, AutocompleteInput, AutocompletePopup, AutocompleteItem, AutocompleteList, AutocompleteEmpty } from '@/components/ui/autocomplete'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DialogRoot, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'

const DEFAULT_SEED_TEXT =
  'The quick beige fox jumps over the lazy dog, while technical metrics show zero acoustic drift across the localized subnets.'
const DEFAULT_MODEL = 'eleven_multilingual_v2'

type VoiceSettings = {
  voiceId: string
  seedText: string
  model: string
  outputFormat: string
  activeVoiceName: string
}

type VoiceMetadata = {
  codec: string
  sampleRate: number
  bitDepth: number
  duration: number
  fileSize: number
  lastPull: string
} | null

type VoicePanelProps = {
  agentId: string
  currentSettings?: Partial<VoiceSettings>
  onSettingsChange?: (settings: Partial<VoiceSettings>) => void
}

type VoiceListEntry = { name: string; relativePath: string; sizeBytes: number }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(1)}s`
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

async function saveVoiceSettings(
  profileName: string,
  settings: Partial<VoiceSettings>,
): Promise<void> {
  const patch: Record<string, unknown> = {}

  if (settings.voiceId !== undefined) {
    patch.tts = { ...patch.tts, elevenlabs: { voice_id: settings.voiceId } }
  }
  if (settings.seedText !== undefined) {
    if (!patch.tts || typeof patch.tts !== 'object') patch.tts = {}
    ;(patch.tts as any).elevenlabs = {
      ...((patch.tts as any)?.elevenlabs || {}),
      seed_text: settings.seedText,
    }
  }
  if (settings.model !== undefined) {
    if (!patch.tts || typeof patch.tts !== 'object') patch.tts = {}
    ;(patch.tts as any).elevenlabs = {
      ...((patch.tts as any)?.elevenlabs || {}),
      model_id: settings.model,
    }
  }
  if (settings.activeVoiceName !== undefined) {
    patch.tts = { ...patch.tts, openai: { voice: settings.activeVoiceName } }
  }

  // Consolidate elevenlabs sub-object
  if ((patch.tts as any)?.elevenlabs && Object.keys((patch.tts as any).elevenlabs).length === 0) {
    delete (patch.tts as any).elevenlabs
  }
  if ((patch.tts as any)?.openai && Object.keys((patch.tts as any).openai).length === 0) {
    delete (patch.tts as any).openai
  }
  if (!patch.tts || Object.keys(patch.tts).length === 0) {
    delete patch.tts
  }

  const response = await fetch('/api/profiles/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: profileName, patch }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${response.status}`)
  }
}

async function pullVoice(
  agentName: string,
  voiceId: string,
  seedText?: string,
  model?: string,
  outputFormat?: string,
): Promise<{ metadata: VoiceMetadata; output: string }> {
  const response = await fetch('/api/voice-pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName,
      voiceId,
      seedText,
      model,
      outputFormat,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${response.status}`)
  }

  const data = await response.json()
  return { metadata: data.metadata, output: data.pullOutput || '' }
}

async function fetchVoiceStatus(agentName: string): Promise<VoiceMetadata> {
  try {
    const res = await fetch(`/api/voice-status?agentName=${encodeURIComponent(agentName)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.metadata || null
  } catch {
    return null
  }
}

/** Lightweight dropdown wrapper using Menu (themed popup). Panel-local only — not a global component. */
type SelectFieldProps = {
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
  disabled?: boolean
}

function SelectField({ value, options, onChange, disabled }: SelectFieldProps) {
  return (
    <div className="relative mt-1">
      <MenuRoot>
        <MenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="h-9 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 pr-8 text-sm text-primary-900 outline-none transition focus:border-primary-500 focus:ring-[3px] focus:ring-primary-500/24 disabled:opacity-50"
          >
            {options.find((o) => o.value === value)?.label || value}
            <HugeiconsIcon icon={ChevronDown} size={16} className="pointer-events-none absolute right-2 top-2.5 text-primary-400" />
          </button>
        </MenuTrigger>
        <MenuContent side="bottom" align="start" className="min-w-(--anchor-width)">
          {options.map((opt) => (
            <MenuItem
              key={opt.value}
              style={{ fontWeight: opt.value === value ? 600 : 450 }}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
    </div>
  )
}

export function VoicePanel({ agentId, currentSettings }: VoicePanelProps) {
  const [settings, setSettings] = useState<VoiceSettings>({
    voiceId: currentSettings?.voiceId || '',
    seedText: currentSettings?.seedText ?? DEFAULT_SEED_TEXT,
    model: currentSettings?.model ?? DEFAULT_MODEL,
    outputFormat: 'pcm_48000',
    activeVoiceName: currentSettings?.activeVoiceName || agentId.toLowerCase(),
  })

  const [metadata, setMetadata] = useState<VoiceMetadata>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingPull, setPendingPull] = useState(false)
  const [voiceList, setVoiceList] = useState<VoiceListEntry[]>([])
  const [overwriteConfirm, setOverwriteConfirm] = useState<{ name: string; sizeBytes: number } | null>(null)

  // Fetch voice list on mount and when activeVoiceName changes (for metadata update)
  useEffect(() => {
    fetch('/api/voice-list').then((r) => r.json()).then((d) => d.ok && setVoiceList(d.voices || [])).catch(() => {})
  }, [agentId])

  // Load voice status on mount
  useEffect(() => {
    fetchVoiceStatus(agentId.toLowerCase()).then(setMetadata)
  }, [agentId])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (s: Partial<VoiceSettings>) =>
      saveVoiceSettings(agentId, s),
    onSuccess: () => {
      toast('Voice settings saved', { type: 'success' })
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Failed to save voice settings', {
        type: 'error',
      })
    },
  })

  // Pull mutation
  const pullMutation = useMutation({
    mutationFn: async () => {
      if (!settings.voiceId.trim()) throw new Error('Voice ID is required')
      return pullVoice(
        agentId.toLowerCase(),
        settings.voiceId,
        settings.seedText,
        settings.model,
        settings.outputFormat,
      )
    },
    onSuccess: (result) => {
      setMetadata(result.metadata)
      toast(`Voice pulled for ${agentId}`, { type: 'success' })
      setPendingPull(false)
      setConfirmOpen(false)
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Pull failed', { type: 'error' })
      setPendingPull(false)
      setConfirmOpen(false)
    },
  })

  const isSaving = saveMutation.isPending || pullMutation.isPending

  function handleSave() {
    saveMutation.mutate(settings)
  }

  function handlePull() {
    if (!settings.voiceId.trim()) {
      toast('Enter an ElevenLabs Voice ID first', { type: 'error' })
      return
    }

    // Check if voice name already exists in the list
    const existing = voiceList.find((v) => v.name === settings.activeVoiceName)
    if (existing) {
      setOverwriteConfirm({ name: existing.name, sizeBytes: existing.sizeBytes })
      return
    }

    setConfirmOpen(true)
    setPendingPull(true)
  }

  function confirmPull() {
    pullMutation.mutate()
  }

  const hasSettings = settings.voiceId || settings.activeVoiceName

  return (
    <div className="space-y-4">
      {/* Settings Section */}
      <div className="rounded-2xl border border-primary-200 bg-primary-50/80 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-500">
          Voice Settings
        </h3>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-primary-600">
              ElevenLabs Voice ID
            </span>
            <Input
              value={settings.voiceId}
              disabled={isSaving}
              onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })}
              placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
              className="mt-1 h-9 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-primary-600">Model</span>
            <SelectField
              value={settings.model}
              disabled={isSaving}
              onChange={(v) => setSettings({ ...settings, model: v })}
              options={[
                { label: 'eleven_multilingual_v2', value: 'eleven_multilingual_v2' },
                { label: 'eleven_turbo_v2_5', value: 'eleven_turbo_v2_5' },
              ]}
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-primary-600">
              Seed Text
            </span>
            <textarea
              value={settings.seedText}
              disabled={isSaving}
              onChange={(e) => setSettings({ ...settings, seedText: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none transition resize-none focus:border-primary-500 focus:ring-[3px] focus:ring-primary-500/24 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-primary-600">TTS Voice Name</span>
              <TooltipProvider>
                <TooltipRoot>
                  <TooltipTrigger asChild>
                    <button type="button" className="rounded hover:bg-primary-200/50 p-0.5 transition-colors">
                      <HugeiconsIcon icon={InformationCircleFreeIcons} size={14} className="text-primary-400" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] whitespace-normal leading-relaxed">
                    The filename used for this agent's voice reference file in /opt/ai/moss-tts/voices/. When pulling from ElevenLabs, the file will be saved under this name. Changing this field does not rename any existing file.
                  </TooltipContent>
                </TooltipRoot>
              </TooltipProvider>
            </div>
            <Autocomplete
              value={settings.activeVoiceName}
              onChange={(_, value: string) => {
                setSettings({ ...settings, activeVoiceName: value })
                if (value) fetchVoiceStatus(value).then(setMetadata)
              }}
              items={voiceList.map((v) => v.name)}
              disabled={isSaving}
            >
              <div className="mt-1">
                <AutocompleteInput
                  placeholder="agent name"
                  showClear
                  disabled={isSaving}
                />
              </div>
              <AutocompletePopup>
                <AutocompleteList>
                  {voiceList.map((v) => (
                    <AutocompleteItem key={v.name} value={v.name}>
                      {v.name}
                    </AutocompleteItem>
                  ))}
                  {voiceList.length === 0 && (
                    <AutocompleteEmpty>No voice files found</AutocompleteEmpty>
                  )}
                </AutocompleteList>
              </AutocompletePopup>
            </Autocomplete>
            {metadata && (
              <span className="mt-1 block text-[10px] text-primary-400">
                {metadata.codec} · {(metadata.sampleRate / 1000).toFixed(1)}kHz · {metadata.bitDepth}-bit · {formatDuration(metadata.duration)}
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-primary-600">Output Format</span>
            <SelectField
              value={settings.outputFormat}
              disabled={isSaving}
              onChange={(v) => setSettings({ ...settings, outputFormat: v })}
              options={[
                { label: 'pcm_48000 — 48kHz 16-bit mono (recommended)', value: 'pcm_48000' },
                { label: 'pcm_44100 — 44.1kHz 16-bit mono', value: 'pcm_44100' },
                { label: 'pcm_24000 — 24kHz 16-bit mono', value: 'pcm_24000' },
                { label: 'pcm_16000 — 16kHz 16-bit mono', value: 'pcm_16000' },
                { label: 'mp3_44100_128 — 44.1kHz 128kbps MP3', value: 'mp3_44100_128' },
                { label: 'mp3_44100_192 — 44.1kHz 192kbps MP3', value: 'mp3_44100_192' },
              ]}
            />
          </label>
        </div>

        <div className="mt-4 flex gap-3">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasSettings || isSaving}
            variant="outline"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>

          <Button
            size="sm"
            onClick={handlePull}
            disabled={isSaving}
          >
            {pullMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                Pulling from ElevenLabs...
              </span>
            ) : (
              'Pull from ElevenLabs'
            )}
          </Button>
        </div>
      </div>

      {/* Status Section */}
      <div className="rounded-2xl border border-primary-200 bg-primary-50/80 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary-500">
          Voice Status
        </h3>

        {metadata ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['Codec', metadata.codec],
              ['Sample Rate', `${metadata.sampleRate} Hz`],
              ['Bit Depth', `${metadata.bitDepth}-bit`],
              ['Duration', formatDuration(metadata.duration)],
              ['File Size', formatFileSize(metadata.fileSize)],
              ['Last Pulled', formatTimestamp(metadata.lastPull)],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-xs text-primary-500">{label}</p>
                <p className="mt-1 text-sm font-medium text-primary-900">
                  {value}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-primary-200 bg-primary-100/60 px-4 py-6 text-center">
            <p className="text-sm font-medium text-primary-700">No voice file</p>
            <p className="mt-1 text-xs text-primary-500">
              Configure the ElevenLabs Voice ID above and click &quot;Pull from ElevenLabs&quot; to generate a reference clip.
            </p>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <DialogRoot open={confirmOpen} onOpenChange={(open) => { if (!open) setPendingPull(false) }}>
        <DialogContent>
          <div className="p-5 space-y-3">
            <DialogTitle>Pull voice from ElevenLabs?</DialogTitle>
            <DialogDescription>
              This will generate a TTS clip using Voice ID &quot;{settings.voiceId}&quot; and save it as the reference for {agentId}. Takes ~10-15 seconds.
            </DialogDescription>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={confirmPull}>
                Pull Voice
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>

      {/* Overwrite Confirmation Dialog */}
      {overwriteConfirm && (
        <DialogRoot open onOpenChange={(open) => { if (!open) setOverwriteConfirm(null) }}>
          <DialogContent>
            <div className="p-5 space-y-3">
              <DialogTitle>Overwrite existing voice file?</DialogTitle>
              <DialogDescription>
                A file named &quot;{overwriteConfirm.name}&quot; already exists ({formatFileSize(overwriteConfirm.sizeBytes)}). Overwriting will replace it permanently.
              </DialogDescription>
              <div className="flex justify-end gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => setOverwriteConfirm(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => { setOverwriteConfirm(null); setConfirmOpen(true); }}>
                  Overwrite
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogRoot>
      )}
    </div>
  )
}
