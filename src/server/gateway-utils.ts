/**
 * Gateway utilities — shared between gateway-control and gateway-agent-status API routes.
 * Reads config.yaml model section, queries systemctl status, hits health/detailed endpoint.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { authHeaders } from './gateway-capabilities'

const PROFILES_DIR = '/home/mako/.hermes/profiles'
const RESTART_SCRIPT = '/opt/ai/bin/restart-agent'

export type GatewayConfiguredInfo = {
  baseUrl: string | null
  model: string | null
  contextLength: number | null
  provider: string | null
  /** SHA-256 hash of config.yaml content at last gateway start — used for restart-required detection */
  startedHash: string | null
} | null

export type GatewayLiveInfo = {
  serviceStatus: 'active' | 'inactive' | 'failed' | 'unknown'
  lastRestart: string | null
  pid: number | null
  activeAgents: number | null
  gatewayState: string | null
  platformsConnected: Array<string>
}

export type GatewayControlResult = {
  ok: boolean
  message: string
  serviceStatus?: string
  error?: string
}

function runCommand(
  command: string,
  args: Array<string>,
  timeoutMs = 30_000,
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

/** Read the model section from an agent's config.yaml */
export async function getConfiguredInfo(agentName: string): Promise<GatewayConfiguredInfo> {
  const configPath = `${PROFILES_DIR}/${agentName}/config.yaml`
  if (!fs.existsSync(configPath)) return null

  // Compute current config hash for restart-required detection
  let startedHash: string | null = null
  try {
    const content = fs.readFileSync(configPath, 'utf8')
    const currentHash = crypto.createHash('sha256').update(content).digest('hex')

    // Read the hash stored at last gateway start
    const hashFile = `${PROFILES_DIR}/${agentName}/.last-started-config-hash`
    if (fs.existsSync(hashFile)) {
      startedHash = fs.readFileSync(hashFile, 'utf8').trim()
    } else {
      // No hash file yet — treat current config as the baseline
      startedHash = currentHash
    }
  } catch {
    startedHash = null
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8')
    // Simple YAML parsing for the model section — avoid full yaml dependency in server route
    // The model block starts with "model:" at the top level and contains indented keys
    const lines = content.split('\n')
    let inModelBlock = false
    const modelLines: Array<string> = []

    for (const line of lines) {
      if (/^model:\s*$/.test(line)) {
        inModelBlock = true
        continue
      }
      if (inModelBlock) {
        // Top-level keys start at column 0; model sub-keys are indented
        if (/^[a-zA-Z_]/.test(line) && !line.startsWith(' ')) {
          break // hit next top-level key
        }
        modelLines.push(line)
      }
    }

    const modelBlock = modelLines.join('\n')
    const baseUrlMatch = modelBlock.match(/base_url:\s*(.+)$/m)
    const defaultMatch = modelBlock.match(/\bdefault:\s*(.+)$/m)
    const contextMatch = modelBlock.match(/context_length:\s*(\d+)/m)
    const providerMatch = modelBlock.match(/\bprovider:\s*(.+)$/m)

    return {
      baseUrl: baseUrlMatch ? baseUrlMatch[1].trim().replace(/^['"]|['"]$/g, '') : null,
      model: defaultMatch ? defaultMatch[1].trim().replace(/^['"]|['"]$/g, '') : null,
      contextLength: contextMatch ? parseInt(contextMatch[1], 10) : null,
      provider: providerMatch ? providerMatch[1].trim().replace(/^['"]|['"]$/g, '') : null,
      startedHash,
    }
  } catch {
    return null
  }
}

/** Query systemctl for service status and last restart timestamp */
export async function getSystemctlStatus(agentName: string): Promise<{
  serviceStatus: 'active' | 'inactive' | 'failed' | 'unknown'
  lastRestart: string | null
}> {
  const serviceName = `hermes-gateway-${agentName}.service`

  try {
    const result = await runCommand('systemctl', ['status', serviceName], 10_000)

    if (result.code !== 0 && !result.stdout) {
      return { serviceStatus: 'unknown', lastRestart: null }
    }

    // Parse Active line: "Active: active (running) since Wed 2026-06-24 03:18:45 UTC; 14h ago"
    const activeMatch = result.stdout.match(/Active:\s*(\w+)/)
    let serviceStatus: 'active' | 'inactive' | 'failed' | 'unknown' = 'unknown'

    if (activeMatch) {
      const status = activeMatch[1]
      if (status === 'active') serviceStatus = 'active'
      else if (status === 'inactive') serviceStatus = 'inactive'
      else if (status === 'failed') serviceStatus = 'failed'
    }

    // Parse "since" timestamp for last restart
    const sinceMatch = result.stdout.match(/since\s+(.+?);/)
    let lastRestart: string | null = null

    if (sinceMatch) {
      try {
        const parsed = new Date(sinceMatch[1].trim())
        if (!Number.isNaN(parsed.getTime())) {
          lastRestart = parsed.toISOString()
        }
      } catch {
        // fallback: store raw string
        lastRestart = sinceMatch[1].trim()
      }
    }

    return { serviceStatus, lastRestart }
  } catch {
    return { serviceStatus: 'unknown', lastRestart: null }
  }
}

/** Hit the gateway health/detailed endpoint for live routing info */
export async function getHealthInfo(agentName: string): Promise<{
  pid: number | null
  activeAgents: number | null
  gatewayState: string | null
  platformsConnected: Array<string>
}> {
  // Read port from config.yaml instead of hardcoded map
  const port = await readAgentPort(agentName)
  if (!port) return { pid: null, activeAgents: null, gatewayState: null, platformsConnected: [] }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const res = await fetch(`http://127.0.0.1:${port}/health/detailed`, {
      signal: controller.signal,
      headers: authHeaders(),
    })
    clearTimeout(timeout)

    if (!res.ok) return { pid: null, activeAgents: null, gatewayState: null, platformsConnected: [] }

    const data = await res.json().catch(() => ({})) as Record<string, unknown>

    // Extract connected platform names
    const platforms = data.platforms as Record<string, unknown> | undefined
    const connectedPlatforms: Array<string> = []
    if (platforms && typeof platforms === 'object') {
      for (const [name, val] of Object.entries(platforms)) {
        if (typeof val === 'object' && val !== null && (val as any).state === 'connected') {
          connectedPlatforms.push(name)
        }
      }
    }

    return {
      pid: typeof data.pid === 'number' ? data.pid : null,
      activeAgents: typeof data.active_agents === 'number' ? data.active_agents : null,
      gatewayState: typeof data.gateway_state === 'string' ? data.gateway_state : null,
      platformsConnected: connectedPlatforms,
    }
  } catch {
    return { pid: null, activeAgents: null, gatewayState: null, platformsConnected: [] }
  }
}

/** Combine systemctl + health into single live info */
export async function getLiveInfo(agentName: string): Promise<GatewayLiveInfo> {
  const [systemctlResult, healthResult] = await Promise.all([
    getSystemctlStatus(agentName),
    getHealthInfo(agentName),
  ])

  return {
    serviceStatus: systemctlResult.serviceStatus,
    lastRestart: systemctlResult.lastRestart,
    pid: healthResult.pid,
    activeAgents: healthResult.activeAgents,
    gatewayState: healthResult.gatewayState,
    platformsConnected: healthResult.platformsConnected,
  }
}

/** Execute a gateway control action (start/stop/restart) via the canonical script */
export async function executeControlAction(
  agentName: string,
  action: 'start' | 'stop' | 'restart',
): Promise<GatewayControlResult> {
  const serviceName = `hermes-gateway-${agentName}`

  // Verify service exists first
  const checkResult = await runCommand('systemctl', ['list-unit-files', `${serviceName}.service`], 5_000)
  if (!checkResult.stdout.includes(serviceName)) {
    return {
      ok: false,
      message: '',
      error: `Service '${serviceName}.service' not found on this system.`,
    }
  }

  let execResult: Awaited<ReturnType<typeof runCommand>>

  if (action === 'restart') {
    // Use canonical restart-agent script for restart (requires sudo — system service)
    if (!fs.existsSync(RESTART_SCRIPT)) {
      return {
        ok: false,
        message: '',
        error: `Restart script not found: ${RESTART_SCRIPT}`,
      }
    }
    execResult = await runCommand('sudo', [RESTART_SCRIPT, agentName], 30_000)
    if (execResult.code !== 0) {
      return {
        ok: false,
        message: '',
        error: `Restart failed: ${execResult.stderr.trim() || 'Unknown error'}`,
      }
    }
  } else {
    // Start/stop via systemctl directly (restart-agent only handles restart, requires sudo)
    execResult = await runCommand('sudo', ['/bin/systemctl', action, serviceName], 30_000)
    if (execResult.code !== 0 && !execResult.stdout.includes('loaded')) {
      return {
        ok: false,
        message: '',
        error: `${action.charAt(0).toUpperCase() + action.slice(1)} failed: ${execResult.stderr.trim() || 'Unknown error'}`,
      }
    }
  }

  // Wait briefly then check new status
  await new Promise((r) => setTimeout(r, 2000))
  const { serviceStatus } = await getSystemctlStatus(agentName)

  return {
    ok: true,
    message: `${agentName} gateway ${action}ed successfully.`,
    serviceStatus,
  }
}

/** Read the gateway port from an agent's config.yaml */
export async function readAgentPort(agentName: string): Promise<number | null> {
  const configPath = `${PROFILES_DIR}/${agentName}/config.yaml`
  if (!fs.existsSync(configPath)) return null

  try {
    const content = fs.readFileSync(configPath, 'utf8')
    // Parse platforms.api_server.extra.port from YAML
    // Look for the active (non-commented) api_server block with port inside extra: section
    const lines = content.split('\n')
    let inApiServer = false
    let inExtra = false
    let indentLevel = 0

    for (const line of lines) {
      if (/^\s*api_server:\s*$/.test(line)) {
        // Check this is under platforms section (look back for 'platforms:')
        const trimmed = line.replace(/\S.*$/, '')
        inApiServer = true
        indentLevel = trimmed.length
        continue
      }
      if (inApiServer && /^\s*extra:\s*$/.test(line)) {
        inExtra = true
        continue
      }
      if (inExtra) {
        const portMatch = line.match(/^\s+port:\s*(\d+)/)
        if (portMatch) {
          return parseInt(portMatch[1], 10)
        }
        // Check if we've left the extra block (hit a non-indented or same-indent key)
        const currentIndent = line.replace(/\S.*$/, '').length
        if (line.trim() && currentIndent <= indentLevel + 2 && !/^\s*port:/.test(line)) {
          inExtra = false
        }
      } else if (inApiServer && /^\s*[a-z]/.test(line) && line.trim()) {
        const currentIndent = line.replace(/\S.*$/, '').length
        if (currentIndent <= indentLevel && !line.startsWith(' ')) {
          inApiServer = false // left platforms section entirely
        }
      }
    }
  } catch {
    return null
  }

  return null
}
