import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hermes >= v0.23.1 fences session rename/delete with a "mutation identity".
// These tests pin the request shapes sent to the dashboard.
const dashboardFetch = vi.fn()

vi.mock('./gateway-capabilities', () => ({
  dashboardFetch: (...args: Array<unknown>) => dashboardFetch(...args),
  CLAUDE_DASHBOARD_URL: 'http://dashboard.test',
}))

import {
  deleteSession,
  getSessionMutationSnapshot,
  updateSession,
} from './claude-dashboard-api'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function snapshot(over: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    exists: true,
    runtime_revision: 7,
    runtime_generation: 3,
    ...over,
  }
}

beforeEach(() => {
  dashboardFetch.mockReset()
})

describe('getSessionMutationSnapshot', () => {
  it('reads the snapshot endpoint, with the profile when given', async () => {
    dashboardFetch.mockResolvedValueOnce(json(snapshot()))
    await getSessionMutationSnapshot('a b', 'nyx')
    expect(dashboardFetch.mock.calls[0][0]).toBe(
      '/api/sessions/a%20b/mutation-snapshot?profile=nyx',
    )
  })
})

describe('deleteSession', () => {
  it('sends request_id, expected_revision and expected_generation in the query', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ ok: true }))
    await deleteSession('s1')
    const [path, init] = dashboardFetch.mock.calls[1]
    expect(init.method).toBe('DELETE')
    const url = new URL(`http://x${path}`)
    expect(url.pathname).toBe('/api/sessions/s1')
    expect(url.searchParams.get('request_id')).toMatch(/^del_/)
    expect(url.searchParams.get('expected_revision')).toBe('7')
    expect(url.searchParams.get('expected_generation')).toBe('3')
  })

  it('sends expected_generation=0 when the snapshot has none (the server rejects a delete without it), and passes profile', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot({ runtime_generation: null })))
      .mockResolvedValueOnce(json({ ok: true }))
    await deleteSession('s1', 'lyra')
    const url = new URL(`http://x${dashboardFetch.mock.calls[1][0]}`)
    expect(url.searchParams.get('expected_generation')).toBe('0')
    expect(url.searchParams.get('profile')).toBe('lyra')
  })

  it('explains a revision conflict (session changed between snapshot and delete)', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ detail: 'revision_conflict' }, 409))
    await expect(deleteSession('s1')).rejects.toThrow(/changed while the request was in flight/)
  })

  it('treats a missing session as already deleted without calling DELETE', async () => {
    dashboardFetch.mockResolvedValueOnce(json(snapshot({ exists: false })))
    await expect(deleteSession('s1')).resolves.toEqual({
      ok: true,
      already_absent: true,
    })
    expect(dashboardFetch).toHaveBeenCalledTimes(1)
  })

  it('explains a busy session', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ detail: 'session_busy' }, 409))
    await expect(deleteSession('s1')).rejects.toThrow(/busy with an active turn/)
  })

  it('explains a lost turn after a gateway restart', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ detail: 'unknown_execution' }, 409))
    await expect(deleteSession('s1')).rejects.toThrow(/lost across a gateway restart/)
  })

  it('passes other errors through unchanged', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ detail: 'boom' }, 500))
    await expect(deleteSession('s1')).rejects.toThrow(/500/)
  })
})

describe('updateSession', () => {
  it('puts the identity in the PATCH body next to the caller fields', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ ok: true, session_id: 's1', revision: 8 }))
      .mockResolvedValueOnce(json({ id: 's1', title: 'new title' }))
    const out = await updateSession('s1', { title: 'new title' })
    const [path, init] = dashboardFetch.mock.calls[1]
    expect(path).toBe('/api/sessions/s1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body)
    expect(body.title).toBe('new title')
    expect(body.request_id).toMatch(/^upd_/)
    expect(body.expected_revision).toBe(7)
    expect(body.expected_generation).toBe(3)
    // callers expect { session }, v0.23.1's PATCH does not return one
    expect(out).toEqual({ session: { id: 's1', title: 'new title' } })
  })

  it('does not let a caller field override the identity', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ id: 's1' }))
    await updateSession('s1', { title: 't', expected_revision: 999, request_id: 'x' })
    const body = JSON.parse(dashboardFetch.mock.calls[1][1].body)
    expect(body.expected_revision).toBe(7)
    expect(body.request_id).toMatch(/^upd_/)
  })

  it('passes the profile to the snapshot, the PATCH body and the follow-up read', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ id: 's1', title: 't' }))
    await updateSession('s1', { title: 't' }, 'nyx')
    expect(dashboardFetch.mock.calls[0][0]).toBe(
      '/api/sessions/s1/mutation-snapshot?profile=nyx',
    )
    expect(JSON.parse(dashboardFetch.mock.calls[1][1].body).profile).toBe('nyx')
    expect(dashboardFetch.mock.calls[2][0]).toBe('/api/sessions/s1?profile=nyx')
  })

  it('surfaces a failure of the follow-up read after a successful PATCH', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ detail: 'gone' }, 404))
    await expect(updateSession('s1', { title: 't' })).rejects.toThrow(/404/)
  })

  it('fails clearly for a missing session and does not PATCH', async () => {
    dashboardFetch.mockResolvedValueOnce(json(snapshot({ exists: false })))
    await expect(updateSession('s1', { title: 't' })).rejects.toThrow(/not found/)
    expect(dashboardFetch).toHaveBeenCalledTimes(1)
  })

  it('explains a busy session on rename', async () => {
    dashboardFetch
      .mockResolvedValueOnce(json(snapshot()))
      .mockResolvedValueOnce(json({ detail: 'session_busy' }, 409))
    await expect(updateSession('s1', { title: 't' })).rejects.toThrow(
      /busy with an active turn/,
    )
  })
})
