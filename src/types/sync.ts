export type SyncPhase = "daily" | "categories" | "items" | "complete" | "error"

export interface SyncProgressEvent {
  phase: SyncPhase
  status: "fetching" | "writing" | "done" | "error"
  totalProgress: number // 0-100 weighted overall
  detail: string
  counts: { daily: number; categories: number; items: number }
  error?: string
}
