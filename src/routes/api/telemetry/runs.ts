/**
 * Telemetry run history — queries DuckDB via telemetry_query.py --runs.
 * Returns list of pipeline runs with per-stage metadata.
 */
import { execFileSync } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireLocalOrAuth } from '../../../server/auth-middleware'

const TELEMETRY_QUERY = '/opt/ai/pipeline/telemetry_query.py'
const PIPELINE_VENV_PYTHON = '/opt/ai/pipeline/.venv/bin/python3'

export const Route = createFileRoute('/api/telemetry/runs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const output = execFileSync(PIPELINE_VENV_PYTHON, [TELEMETRY_QUERY, '--runs'], {
            encoding: 'utf8',
            timeout: 15_000,
            cwd: '/opt/ai/pipeline',
          })
          const runs = JSON.parse(output.trim())
          return json(runs)
        } catch (err) {
          console.error('Telemetry runs query failed:', err)
          return json([], { status: 503 })
        }
      },
    },
  },
})
