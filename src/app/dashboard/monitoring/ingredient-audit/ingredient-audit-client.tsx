"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Check,
  Clipboard,
  Copy,
  FileText,
  Filter,
  Search,
  X,
} from "lucide-react"
import type {
  IngredientAuditRow,
  IngredientAuditStatus,
} from "@/lib/monitoring/ingredient-audit"

const PdfViewerClient = dynamic(
  () => import("@/app/dashboard/invoices/[id]/components/pdf-viewer-client"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center border border-[var(--hairline)] bg-[var(--paper)]/70 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
        Loading PDF viewer
      </div>
    ),
  },
)

const ISSUE_TAGS = [
  "Wrong canonical",
  "Should be unmatched",
  "Duplicate canonical",
  "Bad extraction",
  "Pack/unit cost issue",
  "Return/noise line",
  "Other",
] as const

type IssueTag = (typeof ISSUE_TAGS)[number]

type SelectionDraft = {
  tags: IssueTag[]
  note: string
}

type FilterState = {
  status: "all" | IngredientAuditStatus
  vendor: string
  category: string
  costSource: "all" | "manual" | "invoice" | "none"
  query: string
}

type Props = {
  rows: IngredientAuditRow[]
}

export function IngredientAuditClient({ rows }: Props) {
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    vendor: "all",
    category: "all",
    costSource: "all",
    query: "",
  })
  const [selected, setSelected] = useState<Record<string, SelectionDraft>>({})
  const [pdfRowId, setPdfRowId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const pdfRow = useMemo(
    () => rows.find((row) => row.rowId === pdfRowId) ?? null,
    [pdfRowId, rows],
  )

  const vendors = useMemo(
    () => unique(rows.map((row) => row.vendorName)),
    [rows],
  )
  const categories = useMemo(
    () => unique(rows.map((row) => row.category ?? "Uncategorized")),
    [rows],
  )

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.total += 1
        acc[row.status] += 1
        if (row.latestInvoiceHasPdf) acc.withPdf += 1
        return acc
      },
      { total: 0, matched: 0, suspect: 0, unmatched: 0, withPdf: 0 },
    )
  }, [rows])

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filters.status !== "all" && row.status !== filters.status) return false
      if (filters.vendor !== "all" && row.vendorName !== filters.vendor) return false
      if (
        filters.category !== "all" &&
        (row.category ?? "Uncategorized") !== filters.category
      ) {
        return false
      }
      if (filters.costSource !== "all") {
        const source = row.costSource ?? "none"
        if (source !== filters.costSource) return false
      }
      if (!q) return true
      const haystack = [
        row.productName,
        row.canonicalName,
        row.sku,
        row.vendorName,
        row.latestInvoiceNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [filters, rows])

  const rowsViewportRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => rowsViewportRef.current,
    estimateSize: () => 84,
    overscan: 8,
  })

  const selectedRows = useMemo(
    () => rows.filter((row) => selected[row.rowId]),
    [rows, selected],
  )

  const prompt = useMemo(
    () => buildPrompt(selectedRows, selected),
    [selectedRows, selected],
  )

  function toggleRow(row: IngredientAuditRow) {
    setSelected((prev) => {
      if (prev[row.rowId]) {
        const next = { ...prev }
        delete next[row.rowId]
        return next
      }
      return {
        ...prev,
        [row.rowId]: {
          tags: defaultTagsFor(row),
          note: "",
        },
      }
    })
  }

  function toggleTag(rowId: string, tag: IssueTag) {
    setSelected((prev) => {
      const draft = prev[rowId]
      if (!draft) return prev
      const has = draft.tags.includes(tag)
      return {
        ...prev,
        [rowId]: {
          ...draft,
          tags: has
            ? draft.tags.filter((existing) => existing !== tag)
            : [...draft.tags, tag],
        },
      }
    })
  }

  function setNote(rowId: string, note: string) {
    setSelected((prev) => {
      const draft = prev[rowId]
      if (!draft) return prev
      return { ...prev, [rowId]: { ...draft, note } }
    })
  }

  async function copyPrompt() {
    if (!prompt) return
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="border border-[var(--hairline-bold)] bg-[var(--paper)]/75 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
              Dev audit · invoice extraction
            </div>
            <h1 className="mt-1 font-display text-[30px] italic leading-tight text-[var(--ink)]">
              Invoice ingredient pickup
            </h1>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid-cols-5">
            <Metric label="Rows" value={counts.total} />
            <Metric label="Matched" value={counts.matched} />
            <Metric label="Suspect" value={counts.suspect} />
            <Metric label="Unmatched" value={counts.unmatched} />
            <Metric label="PDFs" value={counts.withPdf} />
          </div>
        </div>
      </header>

      <section className="border border-[var(--hairline-bold)] bg-[var(--paper)]/75 px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr_0.7fr]">
          <label className="flex items-center gap-2 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--ink-muted)]" />
            <input
              value={filters.query}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, query: event.target.value }))
              }
              placeholder="Search product, canonical, SKU, invoice"
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
            />
          </label>
          <SelectFilter
            label="Status"
            value={filters.status}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                status: value as FilterState["status"],
              }))
            }
            options={[
              ["all", "All status"],
              ["suspect", "Suspect"],
              ["unmatched", "Unmatched"],
              ["matched", "Matched"],
            ]}
          />
          <SelectFilter
            label="Vendor"
            value={filters.vendor}
            onChange={(value) =>
              setFilters((prev) => ({ ...prev, vendor: value }))
            }
            options={[["all", "All vendors"], ...vendors.map((v) => [v, v] as const)]}
          />
          <SelectFilter
            label="Category"
            value={filters.category}
            onChange={(value) =>
              setFilters((prev) => ({ ...prev, category: value }))
            }
            options={[
              ["all", "All categories"],
              ...categories.map((c) => [c, c] as const),
            ]}
          />
          <SelectFilter
            label="Cost"
            value={filters.costSource}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                costSource: value as FilterState["costSource"],
              }))
            }
            options={[
              ["all", "All costs"],
              ["invoice", "Invoice"],
              ["manual", "Manual"],
              ["none", "No cost"],
            ]}
          />
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          <Filter className="h-3.5 w-3.5" />
          Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(500px,1fr)_minmax(680px,50vw)] 2xl:grid-cols-[minmax(560px,1fr)_minmax(760px,54vw)]">
        <section className="min-w-0 border border-[var(--hairline-bold)] bg-[var(--paper)]/75">
          <div className="grid grid-cols-[42px_1.3fr_0.9fr_0.7fr_0.7fr_0.65fr_104px] gap-3 border-b border-[var(--hairline-bold)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
            <span />
            <span>Raw invoice product</span>
            <span>Canonical</span>
            <span>Invoice</span>
            <span>Cost</span>
            <span>Status</span>
            <span className="text-right">PDF</span>
          </div>
          <div
            ref={rowsViewportRef}
            className="max-h-[calc(100vh-320px)] min-h-[520px] overflow-auto"
          >
            <div
              className="relative"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = filtered[virtualRow.index]
                if (!row) return null
                return (
                  <div
                    key={row.rowId}
                    className="absolute left-0 top-0 w-full"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <AuditRow
                      row={row}
                      selected={Boolean(selected[row.rowId])}
                      pdfActive={pdfRowId === row.rowId}
                      onToggle={() => toggleRow(row)}
                      onOpenPdf={() => setPdfRowId(row.rowId)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <PromptPanel
            selectedRows={selectedRows}
            selected={selected}
            prompt={prompt}
            copied={copied}
            onCopy={copyPrompt}
            onClear={() => setSelected({})}
            onToggleTag={toggleTag}
            onNote={setNote}
            onRemove={(rowId) =>
              setSelected((prev) => {
                const next = { ...prev }
                delete next[rowId]
                return next
              })
            }
          />
          <PdfPanel row={pdfRow} onClose={() => setPdfRowId(null)} />
        </aside>
      </div>
    </div>
  )
}

function AuditRow({
  row,
  selected,
  pdfActive,
  onToggle,
  onOpenPdf,
}: {
  row: IngredientAuditRow
  selected: boolean
  pdfActive: boolean
  onToggle: () => void
  onOpenPdf: () => void
}) {
  const statusTone =
    row.status === "unmatched"
      ? "bg-[var(--accent-bg)]"
      : row.status === "suspect"
        ? "bg-[var(--paper-warm)]"
        : "bg-transparent"

  return (
    <div
      className={`grid grid-cols-[42px_1.3fr_0.9fr_0.7fr_0.7fr_0.65fr_104px] gap-3 border-b border-[var(--hairline)] px-4 py-3 text-[13px] transition ${statusTone} ${
        selected ? "ring-1 ring-inset ring-[var(--accent)]" : ""
      }`}
    >
      <label className="flex items-start pt-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.productName}`}
          className="h-4 w-4 accent-[var(--accent)]"
        />
      </label>

      <div className="min-w-0">
        <div className="truncate font-medium text-[var(--ink)]" title={row.productName}>
          {row.productName}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
          <span>{row.vendorName}</span>
          <span>SKU {row.sku ?? "none"}</span>
          <span>{row.unit ?? "unit"}</span>
          <span>{row.occurrenceCount}x</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[var(--ink)]" title={row.canonicalName ?? undefined}>
          {row.canonicalName ?? "Unmatched"}
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
          {row.canonicalUnit ?? row.canonicalCategory ?? "no canonical"}
        </div>
      </div>

      <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
        <div className="truncate text-[var(--ink)]">{row.latestInvoiceNumber}</div>
        <div>{row.latestInvoiceDate ?? "no date"}</div>
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
        <div className="font-sans text-[13px] font-semibold tabular-nums text-[var(--ink)]">
          {row.currentCost == null ? "No cost" : formatMoney(row.currentCost)}
        </div>
        <div>{row.costSource ?? "none"}</div>
      </div>

      <div className="min-w-0">
        <StatusStamp status={row.status} />
        {row.issueReasons[0] ? (
          <div
            className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-muted)]"
            title={row.issueReasons.join("; ")}
          >
            {row.issueReasons[0]}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onOpenPdf}
          className={`h-8 border px-3 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
            pdfActive
              ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-dark)]"
              : "border-[var(--hairline-bold)] text-[var(--ink)] hover:border-[var(--ink)]"
          }`}
        >
          PDF
        </button>
      </div>
    </div>
  )
}

function PromptPanel({
  selectedRows,
  selected,
  prompt,
  copied,
  onCopy,
  onClear,
  onToggleTag,
  onNote,
  onRemove,
}: {
  selectedRows: IngredientAuditRow[]
  selected: Record<string, SelectionDraft>
  prompt: string
  copied: boolean
  onCopy: () => void
  onClear: () => void
  onToggleTag: (rowId: string, tag: IssueTag) => void
  onNote: (rowId: string, note: string) => void
  onRemove: (rowId: string) => void
}) {
  return (
    <section className="border border-[var(--hairline-bold)] bg-[var(--paper)]/75">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Claude repair prompt
          </div>
          <div className="font-semibold tabular-nums text-[var(--ink)]">
            {selectedRows.length} selected
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={selectedRows.length === 0}
            className="border border-[var(--hairline-bold)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onCopy}
            disabled={!prompt}
            className="inline-flex items-center gap-2 border border-[var(--ink)] bg-[var(--ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--paper)] disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="max-h-72 overflow-auto border-b border-[var(--hairline)]">
        {selectedRows.length === 0 ? (
          <div className="px-4 py-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Select rows that look wrong. Add issue tags and notes, then copy the generated prompt.
          </div>
        ) : (
          selectedRows.map((row) => {
            const draft = selected[row.rowId]
            return (
              <div key={row.rowId} className="border-b border-[var(--hairline)] px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-[var(--ink)]">
                      {row.productName}
                    </div>
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                      {row.vendorName} · SKU {row.sku ?? "none"} · {row.canonicalName ?? "unmatched"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(row.rowId)}
                    aria-label={`Remove ${row.productName}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ISSUE_TAGS.map((tag) => {
                    const active = draft?.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => onToggleTag(row.rowId, tag)}
                        className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] ${
                          active
                            ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-dark)]"
                            : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)]"
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
                <textarea
                  value={draft?.note ?? ""}
                  onChange={(event) => onNote(row.rowId, event.target.value)}
                  placeholder="Note for Claude"
                  className="mt-3 min-h-16 w-full resize-y border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-2 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              </div>
            )
          })
        )}
      </div>

      <textarea
        readOnly
        value={prompt}
        placeholder="Prompt appears here after selecting rows."
        className="h-56 w-full resize-y bg-[var(--paper)] px-4 py-3 font-mono text-[10px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
      />
    </section>
  )
}

function PdfPanel({
  row,
  onClose,
}: {
  row: IngredientAuditRow | null
  onClose: () => void
}) {
  if (!row) {
    return (
      <section className="border border-[var(--hairline-bold)] bg-[var(--paper)]/75 px-4 py-10 text-center">
        <FileText className="mx-auto h-8 w-8 text-[var(--ink-muted)]" />
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          Open a row PDF to inspect the source invoice.
        </div>
      </section>
    )
  }

  return (
    <section className="border border-[var(--hairline-bold)] bg-[var(--paper)]/75">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
            Source PDF
          </div>
          <div className="truncate font-medium text-[var(--ink)]">
            {row.vendorName} · {row.latestInvoiceNumber}
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
            {row.latestInvoiceDate ?? "no date"} · SKU {row.sku ?? "none"} · {formatMoney(row.latestUnitPrice)} unit
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
          aria-label="Close PDF"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-[var(--hairline)] px-4 py-3 text-[12px] text-[var(--ink)]">
        <div className="line-clamp-2 font-medium">{row.productName}</div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
          Qty {formatNumber(row.latestQuantity)} · Total {formatMoney(row.latestExtendedPrice)}
        </div>
      </div>

      <div className="h-[min(82vh,920px)] min-h-[720px] p-3">
        {row.latestInvoiceHasPdf ? (
          <PdfViewerClient invoiceId={row.latestInvoiceId} initialScale={1.45} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 border border-[var(--hairline)] bg-[var(--paper)] px-6 text-center">
            <FileText className="h-9 w-9 text-[var(--ink-muted)]" />
            <div>
              <div className="font-medium text-[var(--ink)]">PDF not available</div>
              <div className="mt-1 max-w-sm text-[12px] text-[var(--ink-muted)]">
                This invoice does not have a stored PDF. Open the invoice detail page for the extracted line items.
              </div>
            </div>
            <Link
              href={`/dashboard/invoices/${row.latestInvoiceId}`}
              className="border border-[var(--ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-[var(--accent-bg)]"
            >
              Open invoice detail
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className="font-sans text-[17px] font-semibold tabular-nums text-[var(--ink)]">
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function StatusStamp({ status }: { status: IngredientAuditStatus }) {
  const label =
    status === "matched"
      ? "Matched"
      : status === "suspect"
        ? "Suspect"
        : "Unmatched"
  return (
    <span
      className={`inline-flex border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${
        status === "matched"
          ? "border-[var(--hairline-bold)] text-[var(--ink-muted)]"
          : "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-dark)]"
      }`}
    >
      {label}
    </span>
  )
}

function defaultTagsFor(row: IngredientAuditRow): IssueTag[] {
  if (row.status === "unmatched") return ["Should be unmatched"]
  if (row.issueReasons.some((reason) => reason.toLowerCase().includes("return"))) {
    return ["Return/noise line"]
  }
  if (row.issueReasons.some((reason) => reason.toLowerCase().includes("cost"))) {
    return ["Pack/unit cost issue"]
  }
  if (row.canonicalDistinctCount > 1) return ["Duplicate canonical"]
  if (row.status === "suspect") return ["Wrong canonical"]
  return ["Other"]
}

function buildPrompt(
  selectedRows: IngredientAuditRow[],
  selected: Record<string, SelectionDraft>,
): string {
  if (selectedRows.length === 0) return ""
  const lines = selectedRows.map((row, index) => {
    const draft = selected[row.rowId]
    return [
      `${index + 1}. ${row.productName}`,
      `   rowId: ${row.rowId}`,
      `   sampleLineItemId: ${row.sampleLineItemId}`,
      `   latestInvoiceId: ${row.latestInvoiceId}`,
      `   latestInvoiceNumber: ${row.latestInvoiceNumber}`,
      `   latestInvoiceDate: ${row.latestInvoiceDate ?? "null"}`,
      `   pdfAvailable: ${row.latestInvoiceHasPdf ? "yes" : "no"}`,
      `   vendor: ${row.vendorName}`,
      `   sku: ${row.sku ?? "null"}`,
      `   unit: ${row.unit ?? "null"}`,
      `   category: ${row.category ?? "null"}`,
      `   latestQty: ${row.latestQuantity}`,
      `   latestUnitPrice: ${row.latestUnitPrice}`,
      `   latestExtendedPrice: ${row.latestExtendedPrice}`,
      `   currentCanonicalId: ${row.canonicalIngredientId ?? "null"}`,
      `   currentCanonicalName: ${row.canonicalName ?? "null"}`,
      `   currentCanonicalUnit: ${row.canonicalUnit ?? "null"}`,
      `   costSource: ${row.costSource ?? "null"}`,
      `   currentCost: ${row.currentCost ?? "null"}`,
      `   detectedReasons: ${row.issueReasons.length ? row.issueReasons.join("; ") : "none"}`,
      `   selectedIssueTags: ${draft?.tags.join(", ") || "none"}`,
      `   note: ${draft?.note.trim() || "none"}`,
    ].join("\n")
  })

  return [
    "We need to fix invoice ingredient pickup in the restaurant-dashboard project.",
    "",
    "Please inspect the current DB mapping and code paths for these selected invoice rows, then propose or apply the minimum safe fix. Do not guess from names only. Use the invoice line ids, invoice ids, canonical ids, SKU matches, aliases, and cost derivation paths as evidence.",
    "",
    "Selected rows:",
    lines.join("\n\n"),
    "",
    "Expected outcome: explain which rows are wrong, which mappings or extraction records should change, and what command/code/data fix is safest. If applying changes, keep them scoped to these rows and preserve account boundaries.",
  ].join("\n")
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)
}
