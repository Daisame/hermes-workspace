/**
 * Telemetry stage detail — queries DuckDB via telemetry_query.py --stage-detail.
 * Returns inference metrics, hardware state, and model config for a specific run+stage.
 */
import { execFileSync } from 'node:child_process'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireLocalOrAuth } from '../../../../server/auth-middleware'

const TELEMETRY_QUERY = '/opt/ai/pipeline/telemetry_query.py'
const PIPELINE_VENV_PYTHON = '/opt/ai/pipeline/.venv/bin/python3'

export const Route = createFileRoute('/api/telemetry/runs/$runId/stages/$stageName')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!requireLocalOrAuth(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const output = execFileSync(PIPELINE_VENV_PYTHON, [
            TELEMETRY_QUERY, '--stage-detail', params.runId, params.stageName,
          ], {
            encoding: 'utf8',
            timeout: 15_000,
            cwd: '/opt/ai/pipeline',
          })
          const details = JSON.parse(output.trim())
          return json(details[0] ?? null)
        } catch (err) {
          console.error('Telemetry stage detail query failed:', err)
          return json(null, { status: 503 })
        }
      },
    },
  },
})
