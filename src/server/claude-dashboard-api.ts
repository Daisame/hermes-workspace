import {
  dashboardFetch,
  CLAUDE_DASHBOARD_URL,
} from './gateway-capabilities'

export type DashboardSession = {
  id: string
  source?: string | null
  user_id?: string | null
  model?: string | null
  title?: string | null
  started_at?: number
  ended_at?: number | null
  end_reason?: string | null
  message_count?: number
  tool_call_count?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  reasoning_tokens?: number
  parent_session_id?: string | null
  last_active?: number | null
  is_active?: boolean
  preview?: string | null
}

export type DashboardMessage = {
  id?: number | string
  session_id?: string
  role: string
  content: string | null
  tool_call_id?: string | null
  tool_calls?: Array<unknown> | string | null
  tool_name?: string | null
  timestamp?: number
  token_count?: number | null
  finish_reason?: string | null
  reasoning?: string | null
}

export type SessionSearchResponse = {
  results: Array<{
    session_id: string
    snippet: string
    role?: string | null
    source?: string | null
    model?: string | null
    session_started?: number | null
  }>
}

export type SkillInfo = {
  name: string
  description: string
  category?: string
  enabled: boolean
}

export type EnvVarInfo = {
  has_value?: boolean
  masked_value?: string | null
  set_in_env?: boolean
  set_in_file?: boolean
  is_set?: boolean
  redacted_value?: string | null
  description?: string
  url?: string | null
  category?: string
  is_password?: boolean
  tools?: string[]
  advanced?: boolean
}

export type CronJob = {
  id: string
  name?: string
  prompt: string
  schedule: { kind: string; expr: string; display: string }
  schedule_display?: string
  enabled: boolean
  state?: string
  deliver?: string
  last_run_at?: string | null
  next_run_at?: string | null
  last_error?: string | null
}

export type ToolsetInfo = {
  name: string
  label: string
  description: string
  enabled: boolean
  configured: boolean
  tools: string[]
}

export type DashboardStatus = {
  version: string
  claude_home: string
  gateway_running?: boolean
  gateway_state?: string | null
  gateway_pid?: number | null
  gateway_health_url?: string | null
  active_sessions?: number
  [key: string]: unknown
}

async function dashboardJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await dashboardFetch(path, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Hermes Agent dashboard ${path}: ${res.status} ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function listSessions(limit = 50, offset = 0): Promise<{
  sessions: DashboardSession[]
  total: number
  limit: number
  offset: number
}> {
  return dashboardJson(
    `/api/sessions?limit=${limit}&offset=${offset}`,
  )
}

export async function getSession(
  id: string,
  profile?: string,
): Promise<DashboardSession> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  return dashboardJson(`/api/sessions/${encodeURIComponent(id)}${query}`)
}

export async function getSessionMessages(id: string): Promise<{
  messages: DashboardMessage[]
  session_started?: number
  model?: string
}> {
  return dashboardJson(`/api/sessions/${encodeURIComponent(id)}/messages`)
}

export async function searchSessions(q: string): Promise<SessionSearchResponse> {
  return dashboardJson(`/api/sessions/search?q=${encodeURIComponent(q)}`)
}

// Hermes >= v0.23.1 fences session edits and deletes with a "mutation identity":
// read the snapshot, then send request_id + expected_revision (+ expected_generation).
// Without it the dashboard answers 409 client_upgrade_required.
export type SessionMutationSnapshot = {
  session_id: string
  exists: boolean
  runtime_revision: number
  runtime_generation: number | null
}

export async function getSessionMutationSnapshot(
  id: string,
  profile?: string,
): Promise<SessionMutationSnapshot> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  return dashboardJson(
    `/api/sessions/${encodeURIComponent(id)}/mutation-snapshot${query}`,
  )
}

function mutationIdentity(
  prefix: string,
  snapshot: SessionMutationSnapshot,
  options?: { requireGeneration?: boolean },
): Record<string, string | number> {
  const identity: Record<string, string | number> = {
    request_id: `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    expected_revision: snapshot.runtime_revision,
  }
  if (snapshot.runtime_generation !== null && snapshot.runtime_generation !== undefined) {
    identity.expected_generation = snapshot.runtime_generation
  } else if (options?.requireGeneration) {
    // The server rejects a delete with no expected_generation (invalid_params);
    // the column is NOT NULL DEFAULT 0, so 0 is the generation of an untouched session.
    identity.expected_generation = 0
  }
  return identity
}

function explainMutationConflict(action: string, id: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('session_busy')) {
    return new Error(`Cannot ${action} session ${id}: it is busy with an active turn`)
  }
  if (msg.includes('unknown_execution')) {
    return new Error(
      `Cannot ${action} session ${id}: its last turn was lost across a gateway restart`,
    )
  }
  if (msg.includes('revision_conflict')) {
    return new Error(
      `Cannot ${action} session ${id}: it changed while the request was in flight; refresh and try again`,
    )
  }
  return err instanceof Error ? err : new Error(msg)
}

export async function deleteSession(
  id: string,
  profile?: string,
): Promise<{ ok: boolean; already_absent?: boolean }> {
  const snapshot = await getSessionMutationSnapshot(id, profile)
  if (!snapshot.exists) return { ok: true, already_absent: true }

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(
    mutationIdentity('del', snapshot, { requireGeneration: true }),
  )) {
    params.set(k, String(v))
  }
  if (profile) params.set('profile', profile)

  try {
    return await dashboardJson(
      `/api/sessions/${encodeURIComponent(id)}?${params.toString()}`,
      { method: 'DELETE' },
    )
  } catch (err) {
    throw explainMutationConflict('delete', id, err)
  }
}

export async function createSession(
  body: Record<string, unknown>,
): Promise<{ session: DashboardSession }> {
  return dashboardJson('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateSession(
  id: string,
  body: Record<string, unknown>,
  profile?: string,
): Promise<{ session: DashboardSession }> {
  const snapshot = await getSessionMutationSnapshot(id, profile)
  if (!snapshot.exists) {
    throw new Error(`Cannot update session ${id}: session not found`)
  }

  const payload: Record<string, unknown> = {
    ...body,
    ...mutationIdentity('upd', snapshot),
  }
  if (profile && !payload.profile) payload.profile = profile

  try {
    await dashboardJson(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw explainMutationConflict('update', id, err)
  }
  // v0.23.1's PATCH answers {ok, session_id, revision, ...}; callers expect {session}.
  return { session: await getSession(id, profile) }
}

export async function forkSession(
  id: string,
): Promise<{ session: DashboardSession; forked_from: string }> {
  return dashboardJson(`/api/sessions/${encodeURIComponent(id)}/fork`, {
    method: 'POST',
  })
}

export async function getSkills(): Promise<SkillInfo[]> {
  return dashboardJson('/api/skills')
}

export async function toggleSkill(
  name: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  return dashboardJson('/api/skills/toggle', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, enabled }),
  })
}

export async function getConfig(): Promise<Record<string, unknown>> {
  return dashboardJson('/api/config')
}

export async function getConfigSchema(): Promise<{
  fields: Record<string, unknown>
  category_order: string[]
}> {
  return dashboardJson('/api/config/schema')
}

export async function getConfigRaw(): Promise<{ yaml: string }> {
  return dashboardJson('/api/config/raw')
}

/**
 * Deep merge two records. Arrays and non-objects are replaced wholesale;
 * plain objects recurse. Values set to \`null\` in `patch` are treated as
 * explicit removals of the target key.
 */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key]
      continue
    }
    const existing = out[key]
    const bothObjects =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    if (bothObjects) {
      out[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Save a partial config patch. Fetches the current dashboard config first and
 * deep-merges the patch on top so we never send a truncated PUT that would
 * destroy unrelated sections (see issue #85).
 *
 * Callers pass ONLY the fields they want to change; anything not present in
 * `config` is preserved from the current dashboard config.
 */
export async function saveConfig(
  config: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  let merged: Record<string, unknown> = config
  try {
    const current = await getConfig()
    // Dashboards have historically wrapped the config in `{ config: {...} }`.
    // Support both shapes defensively.
    const base =
      current && typeof current === 'object' && 'config' in current
        ? ((current as Record<string, unknown>).config as Record<
            string,
            unknown
          >)
        : (current as Record<string, unknown>)
    if (base && typeof base === 'object') {
      merged = deepMerge(base, config)
    }
  } catch {
    // If we can't read the current config, fall back to sending the raw patch.
    // The dashboard will reject or overwrite — this is no worse than the old
    // behaviour, and the happy path (GET working) is the common case.
  }
  return dashboardJson('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: merged }),
  })
}

export async function saveConfigRaw(
  yaml_text: string,
): Promise<{ ok: boolean }> {
  return dashboardJson('/api/config/raw', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml_text }),
  })
}

export async function getEnvVars(): Promise<Record<string, EnvVarInfo>> {
  return dashboardJson('/api/env')
}

export async function setEnvVar(
  key: string,
  value: string,
): Promise<{ ok: boolean }> {
  return dashboardJson('/api/env', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
}

export async function deleteEnvVar(key: string): Promise<{ ok: boolean }> {
  return dashboardJson('/api/env', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
}

export async function getCronJobs(): Promise<CronJob[]> {
  return dashboardJson('/api/cron/jobs')
}

export async function createCronJob(job: {
  prompt: string
  schedule: string
  name?: string
  deliver?: string
}): Promise<CronJob> {
  return dashboardJson('/api/cron/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  })
}

export async function pauseCronJob(id: string): Promise<CronJob> {
  return dashboardJson(`/api/cron/jobs/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
  })
}

export async function resumeCronJob(id: string): Promise<CronJob> {
  return dashboardJson(`/api/cron/jobs/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
  })
}

export async function triggerCronJob(id: string): Promise<CronJob> {
  return dashboardJson(`/api/cron/jobs/${encodeURIComponent(id)}/trigger`, {
    method: 'POST',
  })
}

export async function deleteCronJob(id: string): Promise<{ ok: boolean }> {
  return dashboardJson(`/api/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function getAnalytics(days = 7): Promise<Record<string, unknown>> {
  return dashboardJson(`/api/analytics/usage?days=${days}`)
}

export async function getModelInfo(): Promise<Record<string, unknown>> {
  return dashboardJson('/api/model/info')
}

export async function getToolsets(): Promise<ToolsetInfo[]> {
  return dashboardJson('/api/tools/toolsets')
}

export async function getOAuthProviders(): Promise<Record<string, unknown>> {
  return dashboardJson('/api/providers/oauth')
}

export async function getLogs(params: {
  file?: string
  lines?: number
  level?: string
  component?: string
}): Promise<Record<string, unknown>> {
  const search = new URLSearchParams()
  if (params.file) search.set('file', params.file)
  if (params.lines) search.set('lines', String(params.lines))
  if (params.level) search.set('level', params.level)
  if (params.component) search.set('component', params.component)
  const suffix = search.toString()
  return dashboardJson(`/api/logs${suffix ? `?${suffix}` : ''}`)
}

export async function getStatus(): Promise<DashboardStatus> {
  return dashboardJson('/api/status')
}

export { CLAUDE_DASHBOARD_URL }
