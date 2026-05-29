import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { TelemetryScreen } from '@/screens/telemetry/telemetry-screen'

export const Route = createFileRoute('/telemetry')({
  ssr: false,
  component: TelemetryRoute,
})

function TelemetryRoute() {
  usePageTitle('Telemetry')
  return <TelemetryScreen />
}
