"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"

interface SectionErrorProps {
  label?: string
  message?: string
}

export function SectionError({
  label = "Section unavailable",
  message,
}: SectionErrorProps) {
  return (
    <div className="relative rounded-none border border-dashed border-(--hairline-bold) bg-[rgba(255,253,248,0.4)] px-4 py-8 text-center">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-(--accent)" />
        <div className="editorial-section-label">{label}</div>
        {message && (
          <p className="text-[12px] text-(--ink-muted)">{message}</p>
        )}
        <p className="text-[11px] text-(--ink-faint)">
          Other sections continue to work. Retry by refreshing the page.
        </p>
      </div>
    </div>
  )
}

interface SectionErrorBoundaryProps {
  label?: string
  children: ReactNode
}

interface SectionErrorBoundaryState {
  hasError: boolean
  message?: string
}

export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SectionErrorBoundary]", this.props.label, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <SectionError label={this.props.label} message={this.state.message} />
      )
    }
    return this.props.children
  }
}
