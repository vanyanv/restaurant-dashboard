"use client"

import dynamic from "next/dynamic"
import { FileWarning, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

const PdfViewerClient = dynamic(() => import("./pdf-viewer-client"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
      Loading viewer...
    </div>
  ),
})

interface PdfViewerProps {
  invoiceId: string
  hasPdf: boolean
}

export function PdfViewer({ invoiceId, hasPdf }: PdfViewerProps) {
  if (!hasPdf) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-center justify-center text-center gap-3 p-6">
          <FileWarning className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">PDF not available</p>
            <p className="text-sm text-muted-foreground mt-1">
              This invoice was synced before PDF storage was enabled. Run
              <code className="mx-1 px-1 py-0.5 rounded bg-muted text-xs">
                npx tsx scripts/backfill-invoice-pdfs.ts
              </code>
              to fetch it from email.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return <PdfViewerClient invoiceId={invoiceId} />
}
