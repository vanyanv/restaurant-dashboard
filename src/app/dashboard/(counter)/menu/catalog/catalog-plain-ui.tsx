"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSurfaceHref } from "@/components/counter";
import { decideProposal } from "@/lib/counter/actions/proposal";
import {
  Answer,
  BigNumber,
  BigNumbers,
  Button,
  ButtonLink,
  Card,
  Freshness,
  NeedsYouItem,
  NeedsYouList,
  Notice,
  Status,
  Statuses,
  useAct,
  useLeaving,
} from "@/components/counter/ui";
import type {
  CatalogPlain,
  CatalogPlainLink,
} from "@/lib/counter/catalog-plain";

/**
 * Menu > Catalog made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 3). The words and
 * counts arrive from `catalog-plain.ts`.
 *
 * "Yes, link" accepts the pending mapping proposal. It is not optimistic: a
 * link moves which recipe a sale is costed against, so the row waits for the
 * save, then slides away and the page refreshes.
 */
export function CatalogPlainView({ p }: { p: CatalogPlain }) {
  const router = useRouter();
  const href = useSurfaceHref();
  const leaving = useLeaving();
  const [notes, setNotes] = useState<
    Array<{ tone: "good" | "bad"; text: string }>
  >([]);

  return (
    <div className="cu-stack">
      <Card label="The catalog in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} />
        </BigNumbers>
      </Card>
      <Statuses>
        {p.statuses.map((s) => (
          <Status key={s.text} tone={s.tone}>
            {s.text}
          </Status>
        ))}
      </Statuses>
      {p.toLink.length > 0 ? (
        <Card
          caption={
            p.more > 0
              ? `To link · ${p.toLink.length} of ${p.toLink.length + p.more}, most sold first`
              : "To link"
          }
        >
          <NeedsYouList>
            {p.toLink.map((l) => (
              <LinkRow
                key={l.key}
                l={l}
                leaving={leaving.isLeaving(l.key)}
                pickHref={href(l.href)}
                onLinked={(text) => {
                  leaving.keep(l.key);
                  setNotes((n) => [...n, { tone: "good", text }]);
                  router.refresh();
                }}
                onFailed={(text) =>
                  setNotes((n) => [...n, { tone: "bad", text }])
                }
              />
            ))}
          </NeedsYouList>
          {notes.map((n, i) => (
            <Notice key={i} tone={n.tone}>
              {n.text}
            </Notice>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function LinkRow({
  l,
  leaving,
  pickHref,
  onLinked,
  onFailed,
}: {
  l: CatalogPlainLink;
  leaving: boolean;
  pickHref: string;
  onLinked: (text: string) => void;
  onFailed: (text: string) => void;
}) {
  const { act, stateOf } = useAct();
  const match = l.match;
  return (
    <NeedsYouItem
      leaving={leaving}
      what={match ? `"${l.item}" → ${match.recipe}` : `"${l.item}"`}
      why={
        match ? `${l.sold} · a likely match` : `${l.sold} · no likely match yet`
      }
    >
      {match ? (
        <Button
          variant="primary"
          state={stateOf("link")}
          doneLabel="Linked"
          onClick={() =>
            act("link", () => decideProposal(match.proposalId, "accept"), {
              done: "Linked",
              onDone: () => onLinked(`Linked "${l.item}" to ${match.recipe}.`),
              onFailed: (e) => onFailed(`"${l.item}" was not linked: ${e}.`),
            })
          }
        >
          Yes, link
        </Button>
      ) : (
        <ButtonLink href={pickHref}>Pick a recipe</ButtonLink>
      )}
    </NeedsYouItem>
  );
}
