/**
 * Voice utilities — shared between voice-pull and voice-status API routes.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const VOICES_DIR = '/opt/ai/shared/voices'

export type VoiceMetadata = {
  codec: string
  sampleRate: number
  bitDepth: number
  channels: number
  duration: number
  fileSize: number
  lastPull: string
} | null

export function runCommand(
  command: string,
  args: Array<string>,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env },
      timeout: timeoutMs,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

export async function getVoiceMetadata(agentName: string): Promise<VoiceMetadata> {
  const wavPath = path.join(VOICES_DIR, agentName, 'reference.wav')
  if (!fs.existsSync(wavPath)) return null

  try {
    const stat = fs.statSync(wavPath)
    const probeResult = await runCommand('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      wavPath,
    ])

    if (probeResult.code !== 0) return null

    const probeData = JSON.parse(probeResult.stdout) as any
    const audioStream = probeData.streams?.[0] || {}
    const format = probeData.format || {}

    return {
      codec: audioStream.codec_long_name || audioStream.codec_name || 'unknown',
      sampleRate: parseInt(audioStream.sample_rate, 10) || 48000,
      bitDepth: parseInt(audioStream.bits_per_sample, 10) || 16,
      channels: parseInt(audioStream.channels, 10) || 1,
      duration: parseFloat(format.duration) || 0,
      fileSize: stat.size,
      lastPull: new Date(stat.mtime).toISOString(),
    }
  } catch {
    return null
  }
}
