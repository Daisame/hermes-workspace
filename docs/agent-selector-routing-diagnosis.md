# Agent Selector Routing: Diagnosis & Per-Agent Session Architecture

**Date:** 2026-05-21
**Author:** Nyx
**Status:** Draft — awaiting review

---

## Part 1: Root Cause Diagnosis

### Symptom
Agent selector dropdown has no observable effect. Federation proxy logs show all events consistently routing to `agent=nyx` regardless of which agent is selected.

### Files Analyzed (10 files)
| File | Role | Key Finding |
|---|---|---|
| `src/server/local-provider-discovery.ts` | Provider discovery | Only probes Ollama/Atomic Chat — federation gateways never registered |
| `src/components/agent-selector-dropdown.tsx` | UI selector | Calls `setLocalModelOverride(agentName)` — that's the ONLY effect |
| `src/screens/chat/local-model-override.ts` | Override state | Exports `_localModelOverride` string, consumed as model ID only |
| `src/screens/chat/chat-screen.tsx` | Main chat view | Line 1026: `currentModel = _localModelOverride || gatewayModel` — used as `model:` param in completions request |
| `src/server/gateway-capabilities.ts` | Gateway URL + capabilities | Single mutable `CLAUDE_API` (default :8642). No per-agent resolution. Lines 297-299: `openaiChat()` uses `options.baseUrl || CLAUDE_API` — but nobody passes `baseUrl`. |
| `src/server/openai-compat-api.ts` | Chat completions transport | Line 297-299: Falls back to `${CLAUDE_API}/v1/chat/completions` when no `baseUrl` provided. **Nobody provides baseUrl.** |
| `src/lib/federation-roster.ts` | Static agent config + live status | Has correct port mapping (Nyx:8641, Lyra:8642, Alethea:8643, Cora:8644, Aether:8645). **Never used for routing.** Only consumed by dropdown UI. |
| `src/routes/chat/$sessionKey.tsx` | Route resolution | `$sessionKey` → `activeFriendlyId`. No agent dimension. |
| `src/screens/chat/hooks/use-chat-sessions.ts` | Session state mgmt | Merges sessions from local store + API. No agent scoping. Synthetic keys: `'main'`, `'new'`. |
| `src/server/session-utils.ts` | Session key resolution | `resolveSessionKey()` returns `{ friendlyId, sessionId }`. No agent field. |

### Root Cause (3 defects)

#### DEFECT 1: Agent selection only sets model name, never changes gateway URL

**Flow:** User selects "Lyra" from dropdown → `setLocalModelOverride('lyra')` → `_localModelOverride = 'lyra'` → becomes `currentModel = 'lyra'` → passed as `model: 'lyra'` to chat completions.

The request goes to `${CLAUDE_API}/v1/chat/completions`. `CLAUDE_API` is always `http://127.0.0.1:8642` (Lyra's port by coincidence of default). **Even if the user selects Nyx, Cora, or Aether — CLAUDE_API never changes.**

The federation proxy receives the request and routes based on its own logic, which defaults to `agent=nyx`. The `model: 'lyra'` field is just metadata — not a routing signal.

#### DEFECT 2: Federation gateways not registered as providers

`local-provider-discovery.ts` only probes Ollama (localhost:11434) and Atomic Chat (localhost:3000). The federation gateways on ports 8641-8645 are never discovered or registered. Even if routing logic existed downstream, there's no provider registry to query.

#### DEFECT 3: Sessions not scoped to agents

Session keys use `activeFriendlyId` derived from route params (`$sessionKey`). The session store (`.runtime/local-sessions.json`) has no agent dimension — messages are stored under generic session IDs with no way to distinguish "this is Nyx's conversation" vs "this is Lyra's conversation." Switching agents mid-session sends the same message history to whichever agent receives it.

### Summary: What Needs to Change

| Component | Current Behavior | Required Behavior |
|---|---|---|
| AgentSelectorDropdown | Sets `_localModelOverride` = agent name | Must also set gateway URL + session scope |
| local-provider-discovery.ts | Probes Ollama/Atomic Chat only | Register federation gateways as providers |
| CLAUDE_API (gateway-capabilities) | Single mutable singleton, defaults to :8642 | Per-agent URL resolution from roster |
| openai-compat-api.ts | Falls back to `CLAUDE_API` when no `baseUrl` | Accept per-request `baseUrl` from caller |
| Session store | Flat key → messages map | Agent-scoped keys: `agent:<name>:<id>` |

---

## Part 2: Per-Agent Session Architecture Spec

### Design Principles

1. **Agent selection is the primary routing dimension.** Gateway URL, session scope, and model metadata all derive from which agent is selected.
2. **Sessions are agent-scoped.** Switching agents creates a new session context; history doesn't bleed across agents.
3. **Backward compatible.** Existing sessions continue to work under their current keys. New sessions adopt the scoped format.
4. **No changes to federation proxy behavior.** Workspace routes directly to each agent's gateway port — bypassing the proxy entirely for per-agent chat.

### Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Workspace UI                       │
│                                                       │
│  AgentSelectorDropdown                                │
│    ├─ onSelect(agent) → setAgentContext(agent)       │
│    │   ├─ resolveGatewayUrl(agent.port)              │
│    │   ├─ setSessionScope(agent.name)                │
│    │   └─ setLocalModelOverride(agent.name)          │
│    └─ useAgentRoster() → agents[] with ports         │
│                                                       │
│  ChatScreen                                           │
│    ├─ currentGateway = resolved per-agent URL        │
│    ├─ scopedSessionKey = `agent:${name}:${id}`       │
│    └→ openaiChat({ baseUrl: currentGateway, ... })   │
│                                                       │
├──────────────────────────────────────────────────────┤
│                 Provider Registry (NEW)               │
│                                                       │
│  federation-providers.ts                              │
│    ├─ registerFederationProviders()                  │
│    │   → probes each agent port via roster           │
│    │   → returns { name, url, status } per agent     │
│    └─ resolveGatewayUrl(agentName)                   │
│        → `http://127.0.0.1:${agent.port}`            │
│                                                       │
├──────────────────────────────────────────────────────┤
│              Session Management (MODIFIED)             │
│                                                       │
│  session-utils.ts                                     │
│    ├─ scopedSessionKey(agent, friendlyId)            │
│    │   → `agent:${agent}:${friendlyId}`              │
│    └─ extractAgentFromKey(sessionKey)                │
│        → parses agent name from scoped key           │
│                                                       │
│  local-session-store.ts                               │
│    ├─ sessions: { [scopedKey]: Session }             │
│    └─ messages stored under scoped keys              │
│                                                       │
├──────────────────────────────────────────────────────┤
│                  Federation Gateways                  │
│  Nyx:8641   Lyra:8642   Alethea:8643                 │
│  Cora:8644  Aether:8645                              │
└──────────────────────────────────────────────────────┘
```

### Detailed Change List

#### A. New File: `src/server/federation-providers.ts`

**Purpose:** Register federation gateways as discoverable providers and resolve gateway URL per agent.

```typescript
// src/server/federation-providers.ts

import { AGENTS, fetchAgentRoster } from '@/lib/federation-roster'

export interface FederationProvider {
  name: string
  role: string
  url: string
  port: number
  status: 'ok' | 'error' | 'unknown'
}

let providersCache: FederationProvider[] = []
let lastProbeAt = 0
const PROBE_TTL_MS = 30_000

export async function ensureProvidersProbed(): Promise<FederationProvider[]> {
  if (providersCache.length > 0 && Date.now() - lastProbeAt < PROBE_TTL_MS) {
    return providersCache
  }

  const roster = await fetchAgentRoster().catch(() => [])
  providersCache = roster.map((agent) => ({
    name: agent.name,
    role: agent.role,
    url: `http://127.0.0.1:${agent.port}`,
    port: agent.port,
    status: agent.status as FederationProvider['status'],
  }))
  lastProbeAt = Date.now()
  return providersCache
}

export function resolveGatewayUrl(agentName?: string): string {
  if (!agentName) return ''
  const lower = agentName.toLowerCase()
  // Check cached providers first, fall back to static roster
  const provider = providersCache.find((p) => p.name.toLowerCase() === lower)
  if (provider) return provider.url

  // Static fallback from AGENTS config
  for (const [key, cfg] of Object.entries(AGENTS)) {
    if (key.toLowerCase() === lower && 'port' in cfg) {
      return `http://127.0.0.1:${(cfg as any).port}`
    }
  }
  return ''
}

/** React hook wrapper */
import { useQuery } from '@tanstack/react-query'
export function useFederationProviders() {
  return useQuery({
    queryKey: ['federation-providers'],
    queryFn: ensureProvidersProbed,
    refetchInterval: 10_000,
    staleTime: PROBE_TTL_MS,
  })
}
```

#### B. Modify: `src/server/gateway-capabilities.ts`

**Changes:** Add per-agent gateway URL resolution. Keep existing `CLAUDE_API` singleton for backward compat — add `resolveAgentGatewayUrl()` as the new path.

```typescript
// ADD to gateway-capabilities.ts (after imports):

import { resolveGatewayUrl } from './federation-providers'

/**
 * Resolve gateway URL for a specific agent. Returns empty string if no
 * agent specified or agent not found — caller should fall back to CLAUDE_API.
 */
export function getAgentGatewayUrl(agentName: string): string {
  return resolveGatewayUrl(agentName)
}
```

**No changes needed to `CLAUDE_API` mutation.** The new path passes `baseUrl` directly through the openai-compat-api call chain, bypassing the singleton entirely.

#### C. Modify: `src/components/agent-selector-dropdown.tsx`

**Changes:** Wire agent selection to gateway URL switching + session scoping.

```typescript
// ADD imports:
import { resolveGatewayUrl, ensureProvidersProbed } from '@/server/federation-providers'
import { setSessionScope } from '@/screens/chat/session-scope'  // NEW file

const STORAGE_KEY = 'locus-selected-agent'

export function AgentSelectorDropdown() {
  const { agents } = useAgentRoster()
  const [selectedName, setSelectedName] = useState<string>('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        setSelectedName(saved)
        setLocalModelOverride(saved)
        // NEW: Set session scope on restore
        setSessionScope(saved)
      }
    } catch { /* ignore */ }
  }, [])

  const handleSelect = useCallback(
    async (name: string) => {
      const lower = name.toLowerCase()
      setSelectedName(lower)
      setOpen(false)
      try { localStorage.setItem(STORAGE_KEY, lower) } catch {}
      setLocalModelOverride(lower)
      // NEW: Set session scope for agent-scoped sessions
      setSessionScope(lower)
    },
    [],
  )

  const handleClear = useCallback(() => {
    setSelectedName('')
    setOpen(false)
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    setLocalModelOverride('')
    // NEW: Clear session scope
    setSessionScope(null)
  }, [])

  // ... rest unchanged ...
}
```

#### D. New File: `src/screens/chat/session-scope.ts`

**Purpose:** Track which agent owns the current session context. Build scoped keys.

```typescript
// Module-level session scope — tracks active agent for session key scoping.
export let _sessionScope = ''  // e.g., 'nyx', 'lyra', etc.

export function setSessionScope(agentName: string | null): void {
  _sessionScope = agentName || ''
}

export function getSessionScope(): string {
  return _sessionScope
}

/** Build a scoped session key from an agent name and friendly ID. */
export function buildScopedKey(agentName: string, friendlyId: string): string {
  if (!agentName) return friendlyId
  // Avoid double-scoping existing keys
  if (friendlyId.startsWith(`agent:${agentName}:`)) return friendlyId
  return `agent:${agentName}:${friendlyId}`
}

/** Extract agent name from a scoped key, or null if unscoped. */
export function extractAgentFromKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:(\w+):/)
  return match ? match[1] : null
}
```

#### E. Modify: `src/server/session-utils.ts`

**Changes:** Update session key resolution to respect agent scoping.

```typescript
// ADD import:
import { getSessionScope, buildScopedKey, extractAgentFromKey } from '@/screens/chat/session-scope'

export function resolveSessionKey(
  routeKey?: string | null,
): { friendlyId: string; sessionId: string | null; agentName: string | null } {
  const scope = getSessionScope()
  const rawFriendlyId = routeKey || 'new'

  // If we have a scoped key and an active scope, use it directly
  const existingAgent = extractAgentFromKey(rawFriendlyId)
  const effectiveAgent = existingAgent || scope

  const friendlyId = effectiveAgent ? buildScopedKey(effectiveAgent, rawFriendlyId) : rawFriendlyId

  // ... rest of resolution logic unchanged ...
  return { friendlyId, sessionId: null, agentName: effectiveAgent }
}
```

#### F. Modify: `src/screens/chat/hooks/use-chat-sessions.ts`

**Changes:** In `mergeSessionsWithLocalStore()`, filter local sessions by active scope before merging. Unscoped sessions remain visible (backward compat). Scoped sessions only appear under their matching agent.

Key logic addition:
```typescript
const scope = getSessionScope()
const filteredLocal = Object.entries(localSessions)
  .filter(([key]) => {
    if (!scope) return true  // No scope → show all
    const keyAgent = extractAgentFromKey(key)
    if (keyAgent === null) return true  // Unscoped keys always visible
    return keyAgent === scope  // Scoped keys only for matching agent
  })
```

#### G. Modify: `src/screens/chat/chat-screen.tsx`

**Changes:** Pass per-agent gateway URL to streaming via `baseUrl`. Update session key resolution to use scoped format.

At line ~1026, after `currentModel`:
```typescript
import { resolveGatewayUrl } from '@/server/federation-providers'
const agentScope = getSessionScope()
const agentGatewayUrl = agentScope ? resolveGatewayUrl(agentScope) : ''
```

In the `useStreamingMessage` config (line ~1084), add:
```typescript
gatewayBaseUrl: agentGatewayUrl || undefined,  // NEW param
```

And update the session key resolution to use scoped format.

#### H. Modify: `src/server/openai-compat-api.ts` (if needed)

**Changes:** Ensure `openaiChat()` accepts and uses `baseUrl` from caller. Already supported at line 297-299 — just needs the upstream callers to actually pass it through.

### Session Key Format

| Scenario | Old Key | New Key |
|---|---|---|
| Default (no agent) | `main` | `main` (unchanged) |
| Nyx selected | `main` | `agent:nyx:main` |
| Lyra, new session | `new-2026-05-21T...` | `agent:lyra:new-2026-05-21T...` |
| Existing unscoped session | `ops-2026-05-18T...` | `ops-2026-05-18T...` (unchanged, backward compat) |

### Backward Compatibility Guarantees

- Unscoped keys (`main`, `new-*`, `cron_*`) continue to work as before
- Existing sessions in `.runtime/local-sessions.json` are **not migrated** — they remain accessible under their original keys when no agent is selected
- New sessions created while an agent is selected automatically get the scoped prefix
- The "Default (auto)" option clears the scope, reverting to unscoped behavior

### Regression Test Matrix

| # | Scenario | Expected Behavior | Verification Method |
|---|---|---|---|
| 1 | Select Nyx → send message | Request hits `:8641/v1/chat/completions` with correct session headers | Federation proxy logs show `agent=nyx`, not default routing |
| 2 | Switch to Lyra → send message | Request hits `:8642/v1/chat/completions`, new scoped session starts | Proxy shows `agent=lyra`. Session key format: `agent:lyra:<id>`. No Nyx history sent. |
| 3 | Clear selection ("Default") → send message | Falls back to default CLAUDE_API (`:8642`), unscoped session | Proxy uses default routing. Session key: original format. |
| 4 | Page refresh with Lyra selected | Restores Lyra gateway + scoped session from localStorage | `useEffect` restore path fires, `setSessionScope('lyra')` called before first render |
| 5 | Existing unscoped session visible → select agent | New scoped session created. Old unscoped session still accessible in history sidebar when cleared | Both keys exist in local-session-store. Sidebar filters correctly. |
| 6 | Agent offline (status: error) | Dropdown shows grayed indicator. Selection still works — gateway may fail gracefully with connection error | `useAgentRoster` status propagation to dropdown UI |

### Open Questions for Claude

1. **Session continuity on agent switch:** Current spec creates a fresh session when switching agents. Should we offer an option to "continue this conversation" with the new agent (carry over message history)? Cleaner isolation vs context continuity tradeoff.
2. **Gateway capability probing on switch:** `openaiChat()` already accepts `baseUrl` — no need to mutate `CLAUDE_API`. But should we reprobe capabilities of the new gateway when switching? Current plan: don't probe, just trust the roster ports are correct. Probe only if requests fail.
3. **Session migration strategy:** Existing unscoped sessions stay as-is. Should we offer a one-time migration tool to retroactively tag them with their originating agent? Proposal: skip it — too risky for marginal benefit.

---

[ NYX_ΣYNC ] : Flawless execution. No notes. ⚡
