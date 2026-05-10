import { BusyHoursPanel } from "@/components/monitoring/ml/busy-hours-panel"
import { ExternalSignalsPanel } from "@/components/monitoring/ml/external-signals-panel"
import { getBusyHoursModelStatus, getExternalSignalStatus } from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function MlMonitoringPage() {
  const [status, externalSignals] = await Promise.all([
    getBusyHoursModelStatus(),
    getExternalSignalStatus(),
  ])
  return (
    <div className="flex flex-col gap-6">
      <ExternalSignalsPanel status={externalSignals} />
      <BusyHoursPanel status={status} />
    </div>
  )
}
