// ─── Sync types ───

export type InvoiceSyncPhase =
  | "fetching-emails"
  | "extracting"
  | "matching"
  | "writing"
  | "complete"
  | "error"

export interface InvoiceSyncProgressEvent {
  phase: InvoiceSyncPhase
  status: "fetching" | "processing" | "writing" | "done" | "error"
  totalProgress: number
  detail: string
  counts: { scanned: number; created: number; skipped: number; errors: number }
  error?: string
}

// ─── Gemini extraction shape ───

export interface InvoiceExtractionLineItem {
  lineNumber: number
  sku: string | null
  productName: string
  description: string | null
  category: string | null
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
}

export interface InvoiceExtraction {
  vendorName: string
  invoiceNumber: string
  invoiceDate: string | null
  dueDate: string | null
  deliveryAddress: string | null
  lineItems: InvoiceExtractionLineItem[]
  subtotal: number | null
  taxAmount: number | null
  totalAmount: number
}

// ─── Dashboard types ───

export interface InvoiceKpis {
  totalSpend: number
  invoiceCount: number
  avgInvoiceTotal: number
  pendingReviewCount: number
  vendorCount: number
  spendByVendor: Array<{ vendor: string; total: number }>
  spendByCategory: Array<{ category: string; total: number }>
}

export interface InvoiceFilters {
  storeId?: string
  status?: string
  vendorName?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

export interface InvoiceListItem {
  id: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string | null
  totalAmount: number
  status: string
  storeName: string | null
  storeId: string | null
  matchConfidence: number | null
  lineItemCount: number
  createdAt: string
}

export interface InvoiceDetailLineItem {
  id: string
  lineNumber: number
  sku: string | null
  productName: string
  description: string | null
  category: string | null
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
}

export interface ProductAnalyticsItem {
  productName: string
  sku: string | null
  category: string | null
  totalQuantity: number
  totalSpend: number
  unit: string | null
  avgUnitPrice: number
  invoiceCount: number
}

export interface ProductAnalytics {
  topProducts: ProductAnalyticsItem[]
}

export interface InvoiceDetail extends InvoiceListItem {
  dueDate: string | null
  deliveryAddress: string | null
  subtotal: number | null
  taxAmount: number | null
  emailSubject: string | null
  emailReceivedAt: string | null
  attachmentName: string | null
  lineItems: InvoiceDetailLineItem[]
}

export interface InvoiceListResponse {
  invoices: InvoiceListItem[]
  total: number
  page: number
  totalPages: number
}

// ─── Store/Vendor breakdown (dashboard snapshot) ───

export interface InvoiceStoreRow {
  storeId: string | null
  storeName: string
  totalSpend: number
  invoiceCount: number
  avgInvoice: number
  vendorCount: number
  needsReview: number
}

export interface InvoiceVendorRow {
  vendorName: string
  totalSpend: number
  invoiceCount: number
  avgInvoice: number
  storeCount: number
  needsReview: number
}

export interface InvoiceBreakdownData {
  storeRows: InvoiceStoreRow[]
  vendorRows: InvoiceVendorRow[]
  storeTotals: Omit<InvoiceStoreRow, "storeId" | "storeName">
  vendorTotals: Omit<InvoiceVendorRow, "vendorName">
}
