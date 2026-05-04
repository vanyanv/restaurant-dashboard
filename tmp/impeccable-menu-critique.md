# Impeccable Menu Critique

Date: 2026-05-03

## Design Health

| # | Heuristic | Score | Key Issue |
|---|---:|---:|---|
| 1 | Visibility of system status | 3 | Counts and filtered totals are visible, but the filter rail overpowers the result state. |
| 2 | Match system / real world | 3 | Ledger language fits the operator, but menu rows drift from the invoice/order row doctrine. |
| 3 | User control and freedom | 3 | Search, filters, sort, and back navigation exist. Filter clearing needs a stronger affordance. |
| 4 | Consistency and standards | 2 | Generic amber/emerald/red utilities and custom row hover weaken dashboard consistency. |
| 5 | Error prevention | 3 | Missing/partial cost flags are present, but status colors are too categorical and noisy. |
| 6 | Recognition rather than recall | 3 | Column labels and badges are legible. The attention rail asks the user to parse too many equally weighted buttons. |
| 7 | Flexibility and efficiency | 4 | Virtualized rows, persisted sort, and direct detail routes support fast owner workflows. |
| 8 | Aesthetic and minimalist design | 2 | The catalog has strong bones, but the filter wall and oversized empty area dilute the editorial hierarchy. |
| 9 | Error recovery | 3 | Empty state suggests recovery. It can be more compact and tied to active controls. |
| 10 | Help and documentation | 3 | Mobile read-only note is clear, but desktop could make recipe provenance/action context clearer. |
| **Total** |  | **29/40** | Solid utility with visible design-system drift. |

## Anti-Patterns Verdict

This does not read as generic AI SaaS, because the cream paper, Fraunces display, mono folios, and tabular figures are distinctive. The main risk is product drift: custom menu rows, generic semantic colors, and a wall of equal-weight controls make the page feel less like the late-edition ledger and more like a bespoke one-off.

## Cognitive Load

Moderate. The category rail can show more than eight visible options, then the attention rail adds five more options with similar visual weight. Progressive disclosure is mostly absent in the filters; the data table itself is efficient once the user reaches it.

## Priority Issues

- **P1, row doctrine drift**: Menu rows use their own hover and do not inherit the red proofmark behavior. Fix with `.inv-row menu-row` and dedicated menu grid CSS.
- **P1, color drift**: Margin and status states use generic green/amber/red utilities on `/dashboard/*`. Fix with editorial tokens: ink, subtract, accent, accent wash.
- **P2, filter hierarchy**: Category and attention buttons compete equally with the result ledger. Fix by grouping filters into labeled rule sections and using `toolbar-btn` states.
- **P2, detail-page weight**: The detail hero and stat rail are useful but too spread out on smaller screens. Fix by tightening the rail, preserving tabular metrics, and making actions secondary.
- **P3, mobile read-only scan**: Mobile menu is functional but sparse. Fix by aligning the search/action toolbar and empty state with the same catalog vocabulary.
