export type SyncPhase = "daily" | "categories" | "items" | "modifiers" | "ratings" | "cogs" | "complete" | "error"

export interface SyncProgressEvent {
  phase: SyncPhase
  status: "fetching" | "writing" | "done" | "error"
  totalProgress: number // 0-100 weighted overall
  detail: string
  counts: { daily: number; categories: number; items: number; modifiers: number; ratings: number; cogs: number }
  error?: string
}
