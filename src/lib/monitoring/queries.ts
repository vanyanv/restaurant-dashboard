// Re-export shim — the monitoring queries were split into domain modules
// under ./queries/ (refactor-playbook run, 2026-06-12). Consumers keep this
// import path; new code may import the leaf modules directly.
// Dead exports getDbGrowth/getSyncRunsByDay (+ their point types) were
// dropped in the same change — zero consumers, recoverable from git.
// NOTE: no "use server" here — it would erase the re-exports at build time.

export {
  getSyncs,
  getSyncsByStore,
  getPendingOrderDetails,
  getStaleStores,
  type SyncRow,
  type StoreSyncCell,
  type StoreSyncGridStore,
  type StoreSyncGrid,
  type PendingDetailsRow,
  type StaleStoreRow,
} from "./queries/sync-health"

export {
  getRecentErrors,
  getErrorCount24h,
  getErrorsByHour,
} from "./queries/errors"

export {
  getAiCostByDay,
  getAiByFeature,
  getChatStats,
  getRecentNonOkChatTurns,
  getAiCostByHour,
} from "./queries/ai-chat"

export {
  getCacheStats,
  getCacheHitRateByDay,
  type CacheHitRateByDayPoint,
} from "./queries/cache"

export {
  getRecentActivity,
  getLoginsByHour,
  getBridgeEvents,
  type ActivityRow,
  type BridgeEventRow,
} from "./queries/feeds"

export {
  getBusyHoursModelStatus,
  getOperatorGateStatus,
  getExternalSignalStatus,
  type BusyHoursRunRow,
  type HarriCoverageRow,
  type StaleBusyHoursForecastRow,
  type BusyHoursAccuracy,
  type BusyHoursModelStatus,
  type OperatorGateRun,
  type OperatorGateSignal,
  type OperatorGateStatus,
  type ExternalSignalCoverageSummary,
  type ExternalSignalFreshnessRow,
  type PromotedModelFlavorRow,
  type ExternalSignalStatus,
} from "./queries/ml-status"
