"use client";

import { useState } from "react";
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
import { confirmInvoiceStore, resolveInvoiceReview } from "@/lib/counter/actions/invoice";
import {
  Answer,
  Freshness,
  Button,
  ButtonLink,
  ButtonRow,
  Card,
  NeedsYouItem,
  NeedsYouList,
  Notice,
  Status,
  Statuses,
  useAct,
  useLeaving,
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
      <Freshness />
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
  const [notes, setNotes] = useState<Array<Note>>([]);
  const leaving = useLeaving();
  const note = (n: Note) => setNotes((all) => [...all.slice(-2), n]);
  const banner =
    notes.length > 0 ? (
      <div className="iv-notes" role="status">
        {notes.map((x, i) => (
          <Notice
            key={i}
            tone={x.tone}
            onUndo={
              x.undo
                ? () => {
                    const undo = x.undo!;
                    setNotes((all) => all.filter((y) => y !== x));
                    undo();
                  }
                : undefined
            }
          >
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
            leaving={leaving}
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

type Note = { tone: "good" | "bad"; text: string; undo?: () => void };

function Task({
  n,
  item,
  stores,
  onNote,
  leaving,
}: {
  n: number;
  item: DeskItem;
  stores: InvoiceWeek["stores"];
  onNote: (note: Note) => void;
  leaving: ReturnType<typeof useLeaving>;
}) {
  void n;
  const surface = useSurfaceHref();
  const router = useRouter();
  const { act, stateOf, doneOf, busy: saving } = useAct();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const others = stores.filter((s) => s.id !== item.confirmStore?.storeId);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const label = `${item.vendor} #${item.number}`;

  // Approving puts the invoice into food cost, so the row waits for the save
  // before it leaves (no optimistic hide); then it slides out and the note
  // above the list offers Undo, which puts the invoice back in review.
  const save = (key: string, storeId: string, name: string) => {
    setError(null);
    act(key, () => confirmInvoiceStore(item.key, storeId), {
      done: `Saved to ${name}`,
      onDone: () => {
        leaving.keep(item.key);
        onNote({
          tone: "good",
          text: `${label} saved to ${name} and approved.`,
          undo: () =>
            act("undo", () => resolveInvoiceReview(item.key, "REVIEW"), {
              onDone: () => {
                leaving.restore(item.key);
                onNote({ tone: "good", text: `${label} is back in review.` });
                // No router.refresh(): resolveInvoiceReview revalidates /dashboard/invoices and /m/invoices.
              },
              onFailed: () => onNote({ tone: "bad", text: `${label} could not be put back in review. Open it to change it.` }),
            }),
        });
        // No router.refresh(): confirmInvoiceStore revalidates /dashboard/invoices and /m/invoices.
      },
      onFailed: (code) => {
        const known = SAVE_ERRORS[code];
        if (known) {
          onNote({ tone: "bad", text: `${label} ${known}` });
          // Kept: a refused save revalidates nothing, and the row is stale (moved or decided elsewhere).
          router.refresh();
        } else {
          setError("That didn't save. Try again, or open the invoice.");
        }
      },
    });
  };

  return (
    <NeedsYouItem
      bad={item.glyph === "miss"}
      leaving={leaving.isLeaving(item.key)}
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
      {item.confirmStore ? (
        <>
          <ButtonRow>
            <Button
              variant="primary"
              state={stateOf("yes")}
              doneLabel={doneOf("yes")}
              disabled={saving}
              onClick={() =>
                save("yes", item.confirmStore!.storeId, item.confirmStore!.storeName)
              }
            >
              {`Yes, ${item.confirmStore.storeName}`}
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
                state={stateOf("move")}
                doneLabel={doneOf("move")}
                disabled={saving || !moveTo}
                onClick={() =>
                  save(
                    "move",
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
