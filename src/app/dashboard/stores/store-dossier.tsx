"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronRight, Loader2 } from "lucide-react"
import { updateStore, deleteStore } from "@/app/actions/store-actions"
import { setStoreTargetCogsPct } from "@/app/actions/cogs-actions"
import { monthlyFromWeekly, weeklyFromMonthly } from "@/lib/pnl"
import { StarRatingLarge } from "@/components/ui/star-rating"
import { YelpSyncButton } from "@/components/yelp-sync-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export interface StoreDossierData {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
  targetCogsPct: number | null
  yelpRating: number | null
  yelpReviewCount: number | null
  yelpUrl: string | null
  yelpUpdatedAt: Date | null
  yelpLastSearch: Date | null
}

interface StoreDossierProps {
  store: StoreDossierData
  isOwner: boolean
  initialEditMode: boolean
}

const FILES = [
  {
    title: "P&L",
    caption: "Daily reconciliation",
    href: (id: string) => `/dashboard/pnl/${id}`,
  },
  {
    title: "COGS",
    caption: "Cost vs target",
    href: (id: string) => `/dashboard/cogs/${id}`,
  },
  {
    title: "Analytics",
    caption: "Sales & traffic",
    href: (id: string) => `/dashboard/analytics/${id}`,
  },
  {
    title: "Invoices",
    caption: "Vendor receipts",
    href: (id: string) => `/dashboard/invoices?storeId=${id}`,
  },
] as const

const fmtMoney = (n: number | null) =>
  n == null
    ? null
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      })

const fmtPct = (n: number | null, decimals = 1) =>
  n == null ? null : `${n.toFixed(decimals)}%`

export function StoreDossier({
  store,
  isOwner,
  initialEditMode,
}: StoreDossierProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(initialEditMode)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (initialEditMode) setEditing(true)
  }, [initialEditMode])

  const weeklyTowelsSeed =
    store.fixedMonthlyTowels != null
      ? String(Math.round(weeklyFromMonthly(store.fixedMonthlyTowels) * 100) / 100)
      : ""

  const [form, setForm] = useState({
    name: store.name,
    address: store.address ?? "",
    phone: store.phone ?? "",
    fixedMonthlyLabor:
      store.fixedMonthlyLabor != null ? String(store.fixedMonthlyLabor) : "",
    fixedMonthlyRent:
      store.fixedMonthlyRent != null ? String(store.fixedMonthlyRent) : "",
    weeklyTowels: weeklyTowelsSeed,
    fixedMonthlyCleaning:
      store.fixedMonthlyCleaning != null
        ? String(store.fixedMonthlyCleaning)
        : "",
    uberCommissionPct: String(
      Math.round(store.uberCommissionRate * 1000) / 10
    ),
    doordashCommissionPct: String(
      Math.round(store.doordashCommissionRate * 1000) / 10
    ),
    targetCogsPct:
      store.targetCogsPct != null ? String(store.targetCogsPct) : "",
    isActive: store.isActive,
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const weeklyTowelsNum = Number(form.weeklyTowels)
  const towelsHint =
    form.weeklyTowels.trim() !== "" &&
    Number.isFinite(weeklyTowelsNum) &&
    weeklyTowelsNum >= 0
      ? `≈ ${fmtMoney(monthlyFromWeekly(weeklyTowelsNum))} / month`
      : null

  const cancel = () => {
    setForm({
      name: store.name,
      address: store.address ?? "",
      phone: store.phone ?? "",
      fixedMonthlyLabor:
        store.fixedMonthlyLabor != null ? String(store.fixedMonthlyLabor) : "",
      fixedMonthlyRent:
        store.fixedMonthlyRent != null ? String(store.fixedMonthlyRent) : "",
      weeklyTowels: weeklyTowelsSeed,
      fixedMonthlyCleaning:
        store.fixedMonthlyCleaning != null
          ? String(store.fixedMonthlyCleaning)
          : "",
      uberCommissionPct: String(
        Math.round(store.uberCommissionRate * 1000) / 10
      ),
      doordashCommissionPct: String(
        Math.round(store.doordashCommissionRate * 1000) / 10
      ),
      targetCogsPct:
        store.targetCogsPct != null ? String(store.targetCogsPct) : "",
      isActive: store.isActive,
    })
    setEditing(false)
  }

  const submit = () => {
    if (!form.name.trim()) {
      toast.error("Store name is required")
      return
    }
    startTransition(async () => {
      const fd = new FormData()
      fd.append("name", form.name)
      if (form.address) fd.append("address", form.address)
      if (form.phone) fd.append("phone", form.phone)
      fd.append("isActive", String(form.isActive))
      fd.append("fixedMonthlyLabor", form.fixedMonthlyLabor)
      fd.append("fixedMonthlyRent", form.fixedMonthlyRent)

      const weeklyStr = form.weeklyTowels.trim()
      if (weeklyStr === "") {
        fd.append("fixedMonthlyTowels", "")
      } else {
        const weekly = Number(weeklyStr)
        fd.append(
          "fixedMonthlyTowels",
          Number.isFinite(weekly) && weekly >= 0
            ? String(monthlyFromWeekly(weekly))
            : ""
        )
      }

      fd.append("fixedMonthlyCleaning", form.fixedMonthlyCleaning)
      fd.append("uberCommissionRate", form.uberCommissionPct)
      fd.append("doordashCommissionRate", form.doordashCommissionPct)

      const result = await updateStore(store.id, fd)
      if (result.error) {
        toast.error("Could not save", { description: result.error })
        return
      }

      const targetStr = form.targetCogsPct.trim()
      const nextTarget = targetStr === "" ? null : Number(targetStr)
      if (
        (store.targetCogsPct ?? null) !== nextTarget &&
        (targetStr === "" ||
          (Number.isFinite(nextTarget) &&
            nextTarget !== null &&
            nextTarget >= 0 &&
            nextTarget <= 100))
      ) {
        const tr = await setStoreTargetCogsPct({
          storeId: store.id,
          targetCogsPct: nextTarget,
        })
        if ("error" in tr) {
          toast.error("Saved store, but COGS target failed", {
            description: tr.error,
          })
          setEditing(false)
          router.refresh()
          return
        }
      }

      toast.success("Store updated")
      setEditing(false)
      router.refresh()
    })
  }

  const handleDeactivate = () => {
    startTransition(async () => {
      const result = await deleteStore(store.id)
      if (result.error) {
        toast.error("Could not deactivate", { description: result.error })
        return
      }
      toast.success(`${store.name} deactivated`, {
        description: "It can be reactivated later from the directory.",
      })
      router.refresh()
    })
  }

  return (
    <div className="store-dossier">
      <header className="store-dossier__masthead">
        <div className="min-w-0">
          {store.address && (
            <div className="store-dossier__addr">{store.address}</div>
          )}
          {store.phone && (
            <div className="store-dossier__contact">{store.phone}</div>
          )}
          {!store.address && !store.phone && (
            <div className="store-dossier__contact">No address on file</div>
          )}
        </div>
        <div className="store-dossier__yelp">
          <StarRatingLarge
            rating={store.yelpRating}
            reviewCount={store.yelpReviewCount}
            url={store.yelpUrl}
            lastUpdated={store.yelpUpdatedAt}
          />
          {isOwner && (
            <YelpSyncButton
              storeId={store.id}
              storeName={store.name}
              hasAddress={!!store.address}
              lastSync={store.yelpLastSearch}
              size="sm"
            />
          )}
        </div>
      </header>

      <section className="store-dossier__section">
        <div className="store-dossier__dept">
          <span>Files</span>
          <span>per-store reports</span>
        </div>
        <nav className="store-files-rail" aria-label="Per-store reports">
          {FILES.map((file) => (
            <Link
              key={file.title}
              href={file.href(store.id)}
              className="store-files-row"
            >
              <span>
                <span className="store-files-row__title">{file.title}</span>
                <span className="store-files-row__caption">
                  {file.caption}
                </span>
              </span>
              <ChevronRight className="store-files-row__chev" aria-hidden />
            </Link>
          ))}
        </nav>
      </section>

      <section className="store-dossier__section">
        <div className="store-dossier__dept">
          <span>Configuration</span>
          {isOwner ? (
            editing ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={cancel}
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="toolbar-btn active"
                  onClick={submit}
                  disabled={isPending}
                >
                  {isPending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Saving
                    </span>
                  ) : (
                    "Save changes"
                  )}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            )
          ) : (
            <span>read-only</span>
          )}
        </div>

        {editing ? (
          <ConfigForm
            form={form}
            set={set}
            towelsHint={towelsHint}
            disabled={isPending}
          />
        ) : (
          <ConfigReadout store={store} />
        )}
      </section>

      {isOwner && !editing && (
        <footer className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-dotted border-(--hairline-bold)">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Store id · {store.id.slice(-8)}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--danger"
                disabled={isPending}
              >
                {store.isActive ? "Deactivate store" : "Reactivate store"}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {store.isActive
                    ? `Deactivate ${store.name}?`
                    : `Reactivate ${store.name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {store.isActive
                    ? "The store will be marked inactive and hidden from default views. Historical data is preserved and the store can be reactivated later."
                    : "Reactivating restores the store to active views. All historical data remains intact."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeactivate}
                  disabled={isPending}
                  className="bg-(--accent) text-white hover:bg-(--accent-dark)"
                >
                  {isPending ? "Working…" : store.isActive ? "Deactivate" : "Reactivate"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </footer>
      )}
    </div>
  )
}

function ConfigReadout({ store }: { store: StoreDossierData }) {
  const towels =
    store.fixedMonthlyTowels != null
      ? weeklyFromMonthly(store.fixedMonthlyTowels)
      : null

  const rows: Array<{
    label: string
    value: string | null
    hint?: string
  }> = [
    {
      label: "Status",
      value: store.isActive ? "Active" : "Inactive",
    },
    {
      label: "Labor · monthly",
      value: fmtMoney(store.fixedMonthlyLabor),
    },
    {
      label: "Rent · monthly",
      value: fmtMoney(store.fixedMonthlyRent),
    },
    {
      label: "Towels · weekly",
      value: towels != null ? fmtMoney(towels) : null,
      hint:
        store.fixedMonthlyTowels != null
          ? `${fmtMoney(store.fixedMonthlyTowels)} / month`
          : undefined,
    },
    {
      label: "Cleaning · monthly",
      value: fmtMoney(store.fixedMonthlyCleaning),
    },
    {
      label: "Uber commission",
      value: fmtPct(store.uberCommissionRate * 100),
    },
    {
      label: "DoorDash commission",
      value: fmtPct(store.doordashCommissionRate * 100),
    },
    {
      label: "COGS target",
      value: fmtPct(store.targetCogsPct, 1),
    },
  ]

  return (
    <dl className="config-ledger">
      {rows.map((row) => (
        <div key={row.label} className="config-ledger__row">
          <dt className="config-ledger__label">{row.label}</dt>
          <dd
            className={
              row.value
                ? "config-ledger__value"
                : "config-ledger__value config-ledger__value--muted"
            }
          >
            {row.value ?? "—"}
            {row.hint && (
              <span className="config-ledger__hint">{row.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface ConfigFormProps {
  form: {
    name: string
    address: string
    phone: string
    fixedMonthlyLabor: string
    fixedMonthlyRent: string
    weeklyTowels: string
    fixedMonthlyCleaning: string
    uberCommissionPct: string
    doordashCommissionPct: string
    targetCogsPct: string
    isActive: boolean
  }
  set: <K extends keyof ConfigFormProps["form"]>(
    key: K,
    value: ConfigFormProps["form"][K]
  ) => void
  towelsHint: string | null
  disabled: boolean
}

function ConfigForm({ form, set, towelsHint, disabled }: ConfigFormProps) {
  return (
    <div className="config-ledger">
      <FormRow label="Store name">
        <input
          type="text"
          className="editorial-input"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          disabled={disabled}
          required
        />
      </FormRow>
      <FormRow label="Address">
        <input
          type="text"
          className="editorial-input"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="123 Main Street, Burbank, CA"
          disabled={disabled}
        />
      </FormRow>
      <FormRow label="Phone">
        <input
          type="text"
          className="editorial-input"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="(818) 555-1212"
          disabled={disabled}
        />
      </FormRow>

      <FormRow label="Status">
        <button
          type="button"
          className="editorial-toggle"
          data-state={form.isActive ? "on" : "off"}
          onClick={() => set("isActive", !form.isActive)}
          disabled={disabled}
          aria-pressed={form.isActive}
        >
          <span className="editorial-toggle__dot" aria-hidden />
          {form.isActive ? "Active" : "Inactive"}
        </button>
      </FormRow>

      <FormRow label="Labor · monthly">
        <MoneyInput
          value={form.fixedMonthlyLabor}
          onChange={(v) => set("fixedMonthlyLabor", v)}
          placeholder="29600"
          disabled={disabled}
        />
      </FormRow>
      <FormRow label="Rent · monthly">
        <MoneyInput
          value={form.fixedMonthlyRent}
          onChange={(v) => set("fixedMonthlyRent", v)}
          placeholder="8500"
          disabled={disabled}
        />
      </FormRow>
      <FormRow label="Towels · weekly" hint={towelsHint ?? undefined}>
        <MoneyInput
          value={form.weeklyTowels}
          onChange={(v) => set("weeklyTowels", v)}
          placeholder="48"
          disabled={disabled}
        />
      </FormRow>
      <FormRow label="Cleaning · monthly">
        <MoneyInput
          value={form.fixedMonthlyCleaning}
          onChange={(v) => set("fixedMonthlyCleaning", v)}
          placeholder="3400"
          disabled={disabled}
        />
      </FormRow>

      <FormRow label="Uber commission">
        <PercentInput
          value={form.uberCommissionPct}
          onChange={(v) => set("uberCommissionPct", v)}
          placeholder="21"
          disabled={disabled}
        />
      </FormRow>
      <FormRow label="DoorDash commission">
        <PercentInput
          value={form.doordashCommissionPct}
          onChange={(v) => set("doordashCommissionPct", v)}
          placeholder="25"
          disabled={disabled}
        />
      </FormRow>
      <FormRow
        label="COGS target"
        hint="Drives the target band on the COGS dashboard"
      >
        <PercentInput
          value={form.targetCogsPct}
          onChange={(v) => set("targetCogsPct", v)}
          placeholder="28.5"
          disabled={disabled}
          step="0.1"
        />
      </FormRow>
    </div>
  )
}

function FormRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="config-ledger__row">
      <dt className="config-ledger__label">{label}</dt>
      <dd className="config-ledger__value">
        {children}
        {hint && <span className="config-ledger__hint">{hint}</span>}
      </dd>
    </div>
  )
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <span className="editorial-field">
      <span className="editorial-field__prefix">$</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="editorial-input editorial-input--prefix"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </span>
  )
}

function PercentInput({
  value,
  onChange,
  placeholder,
  disabled,
  step = "0.1",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  step?: string
}) {
  return (
    <span className="editorial-field">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        max="100"
        className="editorial-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ paddingRight: 22 }}
      />
      <span className="editorial-field__suffix">%</span>
    </span>
  )
}

