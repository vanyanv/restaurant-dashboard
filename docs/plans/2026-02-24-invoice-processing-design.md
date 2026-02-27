# Invoice Processing System - Design Document

**Date:** 2026-02-24
**Status:** Draft

## Problem

Restaurant managers receive supplier invoices (Sysco, US Foods, etc.) via email as PDF attachments. Currently there's no automated way to track, categorize, or analyze this spend data across stores. We need to automatically ingest these invoices, extract structured data, match them to stores, and surface spend analytics in the dashboard.

## Solution

An automated pipeline: Outlook email (Microsoft Graph API) -> PDF extraction (Google Gemini) -> address-based store matching -> PostgreSQL storage -> dashboard analytics.

## Architecture

```
Outlook Inbox
     |  (Microsoft Graph - App-Only Auth)
     v
Fetch emails with PDF attachments
     |
     v
Gemini 2.0 Flash - structured extraction
     |  (vendor, invoice #, dates, address, line items, totals)
     v
Address Matcher - fuzzy match delivery address to Store.address
     |  (confidence score 0-1)
     v
Prisma upsert (Invoice + InvoiceLineItem)
     |
     v
Dashboard (/dashboard/invoices)
```

## Auth: Microsoft Graph (App-Only)

- Azure AD app registration with `Mail.Read` application permission
- Client credentials grant (client_id + client_secret + tenant_id)
- Application Access Policy scopes to the invoice mailbox only
- Token cached in memory, auto-refreshed (same pattern as Otter JWT)

## Data Model

### Invoice
- emailMessageId (unique - dedup key)
- vendorName, invoiceNumber, invoiceDate, dueDate
- deliveryAddress (raw extracted), totalAmount, subtotal, taxAmount
- storeId (nullable until matched), matchConfidence (0-1)
- status: PENDING | MATCHED | REVIEW | APPROVED | REJECTED
- rawExtractionJson (full Gemini response for debugging)

### InvoiceLineItem
- productName, category (Meat/Produce/Dairy/Beverages/etc.)
- quantity, unit (CS/LB/EA/GAL), unitPrice, extendedPrice

### InvoiceSyncLog
- emailsScanned, invoicesCreated, invoicesSkipped, errors
- triggeredBy: "cron" | "manual" | userId

## Gemini Extraction

- Model: gemini-2.0-flash (fast, cheap, good at structured extraction)
- Send PDF as inline base64 with structured output schema
- Prompt tuned for food/beverage distributors (Sysco, US Foods, PFG)
- Auto-categorize line items: Meat, Poultry, Seafood, Produce, Dairy, Bakery, Beverages, Dry Goods, Frozen, Paper/Supplies, Cleaning, Other
- Extract "Ship To" / "Deliver To" address (not billing address)

## Address Matching

- Normalize: lowercase, expand abbreviations (St->Street), remove suite/unit numbers
- Require exact street number match
- Levenshtein distance on normalized street name
- Confidence thresholds: >=0.85 -> MATCHED, 0.7-0.85 -> REVIEW, <0.7 -> PENDING

## Sync Mechanism

- Manual: sync button with SSE streaming progress (same as Otter)
- Scheduled: Vercel cron daily at 8 AM UTC
- Phases: fetching-emails -> extracting -> matching -> writing -> complete
- Concurrency: 3 parallel Gemini calls max
- Dedup: skip emails already processed (emailMessageId check)

## Dashboard UI

- New `/dashboard/invoices` page in sidebar
- KPI cards: Total Spend, Invoice Count, Avg Invoice, Pending Review
- Charts: Spend by Vendor (bar), Spend by Category (pie)
- Invoice table: filterable by status/vendor/store/date, bulk approve/reject
- Detail page: `/dashboard/invoices/[id]` with line items, manual store reassignment

## Dependencies

- `@google/genai` - Gemini SDK
- `@microsoft/microsoft-graph-client` - MS Graph SDK

## Env Vars

```
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_MAIL_USER_ID=
GEMINI_API_KEY=
```
