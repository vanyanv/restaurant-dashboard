// Re-export shim — the forecast chat tools were split into domain modules
// under ./forecasts/ (refactor-playbook run, 2026-06-12). Consumers keep
// this import path; new code may import the leaf modules directly.
// NOTE: no "use server" here — it would erase the re-exports at build time.

export {
  getRevenueForecast,
  getMenuItemForecast,
  getOpenAnomalies,
  type RevenueForecastChatRow,
  type MenuItemForecastChatRow,
  type AnomalyChatRow,
} from "./forecasts/demand"

export {
  getFoodCostForecastTool,
  getLaborStaffingForecastTool,
  getMenuEngineeringTool,
  type FoodCostForecastChatRow,
  type FoodCostForecastChatResult,
  type LaborStaffingChatDay,
  type LaborStaffingChatResult,
  type MenuEngineeringChatRow,
  type MenuEngineeringChatResult,
} from "./forecasts/cost-margin"

export {
  getLostSalesTool,
  getPromoRoiTool,
  getLaunchTrajectoryTool,
  type LostSalesChatRow,
  type LostSalesChatResult,
  type PromoRoiChatEvent,
  type PromoRoiChatResult,
  type LaunchTrajectoryChatRow,
} from "./forecasts/opportunities"

export {
  getCashPositionForecastTool,
  getVendorReliabilityTool,
  getChannelMixTool,
  getWasteRootCausesTool,
  type CashPositionChatDay,
  type CashPositionChatResult,
  type VendorReliabilityChatRow,
  type ChannelMixChatRow,
  type ChannelMixChatResult,
  type WasteClusterChatRow,
} from "./forecasts/operations"
