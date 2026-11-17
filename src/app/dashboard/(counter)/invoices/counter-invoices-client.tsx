"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  useSurfaceHref,
  type Column,
} from "@/components/counter";
import type { SectionSources } from "@/lib/counter/adapters/types";
import type {
  DeskItem,
  InvoiceWeek,
  InvoicesSections,
} from "@/lib/counter/adapters/invoices";
import type { PriceSections } from "@/lib/counter/adapters/prices";
import { confirmInvoiceStore } from "@/lib/counter/actions/invoice";
import {
  Answer,
  Button,
  ButtonLink,
  ButtonRow,
  Card,
  NeedsYouItem,
  NeedsYouList,
  Notice,
  Status,
  Statuses,
} from "@/components/counter/ui";
import { InvoicesHead, useScoped } from "./invoices-ui";

/**
 * Invoices — This week. Invoices mostly check themselves now, so the page
 * opens on what happened in one sentence, then the short list of things that
 * still need the owner (folded shut until asked for: owner, 2026-11-03), then
 * what came in by day, what prices did, and who was paid.
 *
 * Every figure is the adapter's: the sentence, the list and the vendor bars
 * are `week` (whose worklist is `deskOf`'s, the same one the phone queue
 * cuts), and the price box is the Price monitor's own `movers`.
 */
export type CounterInvoicesSections = SectionSources<
  Pick<InvoicesSections, "week">
>;
export type InvoicePriceSections = SectionSources<
  Pick<PriceSections, "movers">
>;

const ASK_SUGGESTIONS = [
  "Which invoices need me, and why?",
  "What did I spend the most on this month?",
  "Which ingredient prices moved against last period?",
];

const PRICE_COLUMNS: Column[] = [
  { key: "ingredient", label: "Item" },
  { key: "median", label: "Usual", numeric: true },
  { key: "latest", label: "Now", numeric: true },
  { key: "costs", label: "Costs you, 30d", numeric: true },
];

const PRICE_ROWS = 5;

export function CounterInvoicesClient({
  sub,
  sections,
  prices,
}: {
  sub: string;
  sections: CounterInvoicesSections;
  prices: InvoicePriceSections;
}) {
  usePageChrome({ leaf: "Invoices", askSuggestions: ASK_SUGGESTIONS });
  const surface = useSurfaceHref();
  const scoped = useScoped();
  const { pending } = useCounterTransition();

  return (
    <>
      <InvoicesHead sub={sub} />

      <Section bare title="This week" data={sections.week} pending={pending}>
        {(w) => <Lede week={w} />}
      </Section>

      <div id="iv-needs" className="iv-needs">
        <Section
          title="Needs you"
          fold="closed"
          meta={needsMeta}
          data={sections.week}
          pending={pending}
          pad={false}
        >
          {(w) => <Needs week={w} />}
        </Section>
      </div>

      <div className="iv-split">
        <Section
          title="What came in"
          meta={(w) => w.window}
          data={sections.week}
          pending={pending}
          pad={false}
          askAbout="what invoices came in this week"
        >
          {(w) => <CameIn week={w} />}
        </Section>

        <div className="iv-stack">
          <Section
            title="Prices that changed"
            meta={() => "ranked by dollars"}
            data={prices.movers}
            pending={pending}
            pad={false}
            askAbout="which ingredient prices moved"
          >
            {(m) => (
              <>
                <Table
                  columns={PRICE_COLUMNS}
                  rows={m.rows.slice(0, PRICE_ROWS)}
                />
                <p className="sh-empty">
                  <Link href={surface("/dashboard/invoices/prices")}>
                    Every price that changed
                  </Link>
                </p>
              </>
            )}
          </Section>

          <Section
            title="Who you paid"
            meta={(w) => `last 30 days · ${w.vendorsTotal}`}
            data={sections.week}
            pending={pending}
            pad={false}
          >
            {(w) => (
              <>
                <div className="iv-bars">
                  {w.vendors.map((v) => (
                    <div className="iv-bar" key={v.name}>
                      <span className="n">{v.name}</span>
                      <span className="track" aria-hidden="true">
                        <span
                          className="fill"
                          style={{
                            width: `${Math.round(v.share * 1000) / 10}%`,
                          }}
                        />
                      </span>
                      <span className="v">{v.amount}</span>
                    </div>
                  ))}
                </div>
                <p className="sh-empty">
                  <Link href={scoped("/dashboard/operations/vendors")}>
                    Every vendor
                  </Link>
                </p>
              </>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

/**
 * The "Needs you" fold's one-line count. A plain function rather than an
 * inline `meta` arrow: React Compiler could not compile a ternary inside the
 * `|| "nothing waiting"` fallback and skipped the whole page because of it.
 */
function needsMeta(w: InvoiceWeek): string {
  const parts: string[] = []
  if (w.needs.length > 0) parts.push(`${plural(w.needs.length, "invoice")} · ${w.needsTotal}`)
  if (w.unlinked) parts.push(`${plural(w.unlinked.lines, "line")} to link`)
  return parts.length > 0 ? parts.join(" · ") : "nothing waiting"
}

function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** Opens the folded Needs you and brings it into view. */
function openNeeds() {
  const box = document.getElementById("iv-needs");
  const fold = box?.querySelector("details");
  if (fold) fold.open = true;
  box?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function Lede({ week }: { week: InvoiceWeek }) {
  const scoped = useScoped();
  return (
    <Card as="section" label="This week in one sentence">
      <Answer>
        {week.lede.map((part, i) =>
          part.strong ? (
            <b key={i}>{part.text}</b>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </Answer>
      <Statuses>
        {week.pills.map((p) =>
          p.href.includes("#iv-needs") ? (
            <Status key={p.label} tone={p.tone} onClick={openNeeds}>
              {p.label}
            </Status>
          ) : (
            <Status key={p.label} tone={p.tone} href={scoped(p.href)}>
              {p.label}
            </Status>
          ),
        )}
      </Statuses>
    </Card>
  );
}

function Needs({ week }: { week: InvoiceWeek }) {
  const scoped = useScoped();
  // Held here, not in the task: a saved task leaves the list on refresh, and
  // its own confirmation would leave with it.
  const [notes, setNotes] = useState<
    Array<{ tone: "good" | "bad"; text: string }>
  >([]);
  const note = (tone: "good" | "bad", text: string) =>
    setNotes((n) => [...n.slice(-2), { tone, text }]);
  const banner =
    notes.length > 0 ? (
      <div className="iv-notes" role="status">
        {notes.map((x, i) => (
          <Notice key={i} tone={x.tone}>
            {x.text}
          </Notice>
        ))}
      </div>
    ) : null;
  if (week.needs.length === 0 && !week.unlinked) {
    return (
      <>
        {banner}
        <p className="sh-empty">
          Nothing needs you. Every invoice is checked and every line is linked.
        </p>
      </>
    );
  }
  return (
    <>
      {banner}
      <NeedsYouList numbered>
        {week.needs.map((it, i) => (
          <Task
            key={it.key}
            n={i + 1}
            item={it}
            stores={week.stores}
            onNote={note}
          />
        ))}
        {week.unlinked ? (
          <NeedsYouItem
            what={
              <>
                Link {plural(week.unlinked.lines, "supply line")} so{" "}
                {week.unlinked.lines === 1 ? "it counts" : "they count"} in your
                costs
              </>
            }
            why={
              <>
                {week.unlinked.total} this week reached no ingredient. Biggest:{" "}
                {week.unlinked.top}.
              </>
            }
          >
            <ButtonRow>
              <ButtonLink variant="primary" href={scoped("/dashboard/ingredients")}>
                Link them
              </ButtonLink>
            </ButtonRow>
          </NeedsYouItem>
        ) : null}
      </NeedsYouList>
    </>
  );
}

const SAVE_ERRORS: Record<string, string> = {
  "not-in-review": "was already settled, so nothing changed.",
  "not-store-only": "is held for more than its store. Open it to review.",
  "does-not-tie-out":
    "doesn't add up, so it can't be approved here. Open it to fix.",
};

function Task({
  n,
  item,
  stores,
  onNote,
}: {
  n: number;
  item: DeskItem;
  stores: InvoiceWeek["stores"];
  onNote: (tone: "good" | "bad", text: string) => void;
}) {
  const surface = useSurfaceHref();
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const others = stores.filter((s) => s.id !== item.confirmStore?.storeId);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");

  const save = (storeId: string, name: string) => {
    setError(null);
    startSaving(async () => {
      const result = await confirmInvoiceStore(item.key, storeId);
      const label = `${item.vendor} #${item.number}`;
      if (!result.ok) {
        const known = SAVE_ERRORS[result.error];
        if (known) {
          onNote("bad", `${label} ${known}`);
          router.refresh();
        } else {
          setError("That didn't save. Try again, or open the invoice.");
        }
        return;
      }
      setDone(`Saved to ${name} and approved.`);
      onNote("good", `${label} saved to ${name} and approved.`);
      router.refresh();
    });
  };

  return (
    <NeedsYouItem
      bad={item.glyph === "miss"}
      what={
        <>
          {item.reason} {item.vendor} #{item.number}, {item.total}
        </>
      }
      why={
        <>
          {item.where} · {item.detail}
        </>
      }
    >
      {done ? (
        <Notice tone="good">{done}</Notice>
      ) : item.confirmStore ? (
        <>
          <ButtonRow>
            <Button
              variant="primary"
              disabled={saving}
              onClick={() =>
                save(item.confirmStore!.storeId, item.confirmStore!.storeName)
              }
            >
              {saving ? "Saving…" : `Yes, ${item.confirmStore.storeName}`}
            </Button>
            {others.length > 0 ? (
              <Button
                disabled={saving}
                onClick={() => setPicking((p) => !p)}
                aria-expanded={picking}
              >
                Different store
              </Button>
            ) : null}
            <ButtonLink variant="quiet" href={surface(item.href)}>
              Open invoice
            </ButtonLink>
          </ButtonRow>
          {picking ? (
            <div className="iv-move">
              <label htmlFor={`move-${item.key}`}>Move it to</label>
              <select
                id={`move-${item.key}`}
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={saving || !moveTo}
                onClick={() =>
                  save(
                    moveTo,
                    others.find((s) => s.id === moveTo)?.name ?? "that store",
                  )
                }
              >
                Move and approve
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <ButtonRow>
          <ButtonLink variant="primary" href={surface(item.href)}>
            {item.act}
          </ButtonLink>
        </ButtonRow>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </NeedsYouItem>
  );
}

function CameIn({ week }: { week: InvoiceWeek }) {
  const surface = useSurfaceHref();
  const scoped = useScoped();
  if (week.days.length === 0) {
    return <p className="sh-empty">No invoices in the last 7 days.</p>;
  }
  return (
    <>
      <div className="iv-days">
        {week.days.map((d) => (
          <div key={d.label} className="iv-day">
            <div className="iv-day__h">{d.label}</div>
            {d.rows.map((r) => (
              <Link key={r.key} href={surface(r.href)} className="iv-row">
                <span className="who">
                  <b>{r.vendor}</b>
                  <span>{r.note}</span>
                </span>
                <span className="where">{r.store}</span>
                <span className="amt">{r.total}</span>
                <Status plain tone={r.status.tone}>
                  {r.status.label}
                </Status>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <p className="sh-empty">
        {week.more > 0
          ? `${plural(week.more, "more invoice")} this week · `
          : null}
        <Link href={scoped("/dashboard/invoices/all")}>See all invoices</Link>
      </p>
    </>
  );
}
