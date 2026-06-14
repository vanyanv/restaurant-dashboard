import { BusyHoursPanel } from "@/components/monitoring/ml/busy-hours-panel"
import { ExternalSignalsPanel } from "@/components/monitoring/ml/external-signals-panel"
import { OperatorGatePanel } from "@/components/monitoring/ml/operator-gate-panel"
import { getBusyHoursModelStatus, getExternalSignalStatus, getOperatorGateStatus } from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function MlMonitoringPage() {
  const [status, externalSignals, operatorGate] = await Promise.all([
    getBusyHoursModelStatus(),
    getExternalSignalStatus(),
    getOperatorGateStatus(),
  ])
  return (
    <div className="flex flex-col gap-6">
      <OperatorGatePanel status={operatorGate} />
      <ExternalSignalsPanel status={externalSignals} />
      <BusyHoursPanel status={status} />
    </div>
  )
}
