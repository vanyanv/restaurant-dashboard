"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Document, Page, pdfjs } from "react-pdf"
import type { PDFDocumentProxy } from "pdfjs-dist"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.25

interface PdfViewerClientProps {
  invoiceId: string
}

const documentOptions = {
  cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.296/cmaps/",
  cMapPacked: true,
} as const

export default function PdfViewerClient({ invoiceId }: PdfViewerClientProps) {
  const fileUrl = useMemo(() => `/api/invoices/${invoiceId}/pdf`, [invoiceId])

  const containerRef = useRef<HTMLDivElement>(null)
  const pageScrollRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setContainerWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: total }: PDFDocumentProxy) => {
      setNumPages(total)
      setPageNumber(1)
      setLoadError(null)
    },
    [],
  )

  const onDocumentLoadError = useCallback((err: Error) => {
    setLoadError(err)
  }, [])

  const goPrev = useCallback(() => {
    setPageNumber((p) => Math.max(1, p - 1))
  }, [])

  const goNext = useCallback(() => {
    setPageNumber((p) => Math.min(numPages || 1, p + 1))
  }, [numPages])

  const zoomIn = useCallback(
    () => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)),
    [],
  )
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)),
    [],
  )
  const resetZoom = useCallback(() => setScale(1), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        goPrev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        goNext()
      }
    }
    const el = containerRef.current
    if (!el) return
    el.addEventListener("keydown", onKey)
    return () => el.removeEventListener("keydown", onKey)
  }, [goPrev, goNext])

  useEffect(() => {
    pageScrollRef.current?.scrollTo({ top: 0 })
  }, [pageNumber])

  const pageWidth = containerWidth > 0 ? containerWidth * scale : undefined

  if (loadError) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-center justify-center text-center gap-3 p-6">
          <FileWarning className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">Failed to load PDF</p>
            <p className="text-sm text-muted-foreground mt-1">
              {loadError.message}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoadError(null)
              setReloadKey((k) => k + 1)
            }}
          >
            <RotateCw className="h-4 w-4 mr-1" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="flex h-full w-full flex-col rounded-md border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/80 backdrop-blur px-2 py-1.5 rounded-t-md">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={goPrev}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1 text-sm tabular-nums">
            <Input
              type="number"
              min={1}
              max={numPages || 1}
              value={pageNumber}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                setPageNumber(Math.max(1, Math.min(numPages || 1, Math.floor(n))))
              }}
              className="h-8 w-14 text-center px-1"
              aria-label="Current page"
            />
            <span className="text-muted-foreground">/ {numPages || "—"}</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={goNext}
            disabled={!numPages || pageNumber >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={resetZoom}
            className="text-xs tabular-nums min-w-[3rem] text-muted-foreground hover:text-foreground"
            aria-label="Reset zoom"
          >
            {Math.round(scale * 100)}%
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <a
            href={fileUrl}
            download={`invoice-${invoiceId}.pdf`}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent"
            aria-label="Download PDF"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Page area */}
      <div
        ref={pageScrollRef}
        className="flex-1 overflow-auto p-2 flex items-start justify-center"
      >
        <Document
          key={reloadKey}
          file={fileUrl}
          options={documentOptions}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Loading PDF...
            </div>
          }
          error={
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              Failed to load PDF.
            </div>
          }
          className="max-w-full"
        >
          {numPages > 0 && pageWidth ? (
            <Page
              key={`page-${pageNumber}-${scale}`}
              pageNumber={pageNumber}
              width={pageWidth}
              renderTextLayer
              renderAnnotationLayer
              loading={
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Rendering page...
                </div>
              }
            />
          ) : null}
        </Document>
      </div>
    </div>
  )
}
