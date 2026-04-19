import { put, get, type PutBlobResult } from "@vercel/blob"

export type InvoicePdfUpload = {
  pathname: string
  url: string
  size: number
  uploadedAt: Date
}

export async function putInvoicePdf(
  emailMessageId: string,
  pdfBytes: Buffer,
): Promise<InvoicePdfUpload> {
  const safeId = emailMessageId.replace(/[^A-Za-z0-9._-]/g, "_")
  const result: PutBlobResult = await put(`invoices/${safeId}.pdf`, pdfBytes, {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: true,
  })
  return {
    pathname: result.pathname,
    url: result.url,
    size: pdfBytes.byteLength,
    uploadedAt: new Date(),
  }
}

export async function getInvoicePdfStream(pathname: string) {
  return get(pathname, { access: "private" })
}
