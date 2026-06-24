/**
 * Voice Management Panel — ElevenLabs pull + ffprobe metadata display.
 * Renders as a tab inside the Agent Profile page.
 */
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
): Promise<{ metadata: VoiceMetadata; output: string }> {
  const response = await fetch('/api/voice-pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName,
      voiceId,
      seedText,
      model,
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

export function VoicePanel({ agentId, currentSettings }: VoicePanelProps) {
  const [settings, setSettings] = useState<VoiceSettings>({
    voiceId: currentSettings?.voiceId || '',
    seedText: currentSettings?.seedText ?? DEFAULT_SEED_TEXT,
    model: currentSettings?.model ?? DEFAULT_MODEL,
    outputFormat: 'pcm_48000 / 48kHz 16-bit mono',
    activeVoiceName: currentSettings?.activeVoiceName || agentId.toLowerCase(),
  })

  const [metadata, setMetadata] = useState<VoiceMetadata>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingPull, setPendingPull] = useState(false)

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
            <span className="text-xs font-medium text-primary-600">
              Model
            </span>
            <select
              value={settings.model}
              disabled={isSaving}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              className="mt-1 h-9 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 text-sm text-primary-900 outline-none transition focus:border-primary-300 disabled:opacity-50"
            >
              <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
              <option value="eleven_turbo_v2_5">eleven_turbo_v2_5</option>
            </select>
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
              className="mt-1 w-full rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none transition resize-none focus:border-primary-300 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-primary-600">
              Active Voice Name
            </span>
            <Input
              value={settings.activeVoiceName}
              disabled={isSaving}
              onChange={(e) => setSettings({ ...settings, activeVoiceName: e.target.value })}
              placeholder="agent name"
              className="mt-1 h-9 text-sm"
            />
          </label>

          <div className="block">
            <span className="text-xs font-medium text-primary-600">
              Output Format
            </span>
            <div className="mt-1 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-500">
              {settings.outputFormat}
            </div>
          </div>
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
    </div>
  )
}
