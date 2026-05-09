# Inventory + ML Roadmap — Backlog Mapping

This is the canonical mapping between the plan-document feature IDs (`F1`–`F29`) and their GitHub Issues + Milestones in `vanyanv/restaurant-dashboard`.

Source plan: `/home/vardan/.claude/plans/based-on-all-information-prancy-lovelace.md` (also linked from CLAUDE.md when adopted).

When committing work for a feature, reference its issue with `Closes #N` in the PR body so the issue closes on merge and the milestone progress bar updates automatically.

## Phase 1 — Inventory data model + opening count (Milestone 1)

| ID | Issue | Title |
|---|---|---|
| F1 | [#3](https://github.com/vanyanv/restaurant-dashboard/issues/3) | Stock count entry (opening + weekly) |

## Phase 2 — Compute + read-side dashboard (Milestone 2)

| ID | Issue | Title |
|---|---|---|
| F2 | [#4](https://github.com/vanyanv/restaurant-dashboard/issues/4) | Running on-hand estimate (`computeRunningOnHand`) |
| F3 | [#5](https://github.com/vanyanv/restaurant-dashboard/issues/5) | Reorder timing per ingredient + per vendor |
| F4 | [#6](https://github.com/vanyanv/restaurant-dashboard/issues/6) | Coverage health widget (recipe + conversion gaps) |

## Phase 3 — Weekly cycle + waste delta (Milestone 3)

| ID | Issue | Title |
|---|---|---|
| F5 | [#7](https://github.com/vanyanv/restaurant-dashboard/issues/7) | Adjustment quick-add (theft / expiry / supplier return) |
| F6 | [#8](https://github.com/vanyanv/restaurant-dashboard/issues/8) | Weekly waste delta report |

## Phase 4 — Bayesian calibration + graduation (Milestone 4)

| ID | Issue | Title |
|---|---|---|
| F7 | [#9](https://github.com/vanyanv/restaurant-dashboard/issues/9) | Bayesian calibration + ingredient graduation |
| F8 | [#10](https://github.com/vanyanv/restaurant-dashboard/issues/10) | Anomaly alerts on count delta |

## Phase 5 — ML forecasting + hybrid AI core (Milestone 5)

| ID | Issue | Title |
|---|---|---|
| F9 | [#11](https://github.com/vanyanv/restaurant-dashboard/issues/11) | Daily / hourly / weekly revenue forecasting |
| F10 | [#12](https://github.com/vanyanv/restaurant-dashboard/issues/12) | Menu item demand forecasting per store |
| F11 | [#13](https://github.com/vanyanv/restaurant-dashboard/issues/13) | Inventory depletion forecasting |
| F12 | [#14](https://github.com/vanyanv/restaurant-dashboard/issues/14) | Operational anomaly detection |
| F13 | [#15](https://github.com/vanyanv/restaurant-dashboard/issues/15) | Recipe inference via NNLS |
| F14 | [#16](https://github.com/vanyanv/restaurant-dashboard/issues/16) | Hybrid LLM insight feed (ML + pgvector + Claude) |

## Phase 6 — Direct-money features (Milestone 6)

| ID | Issue | Title |
|---|---|---|
| F15 | [#17](https://github.com/vanyanv/restaurant-dashboard/issues/17) | Forward food cost % forecast |
| F16 | [#18](https://github.com/vanyanv/restaurant-dashboard/issues/18) | Price elasticity per item |
| F17 | [#19](https://github.com/vanyanv/restaurant-dashboard/issues/19) | Promotion ROI prediction |
| F18 | [#20](https://github.com/vanyanv/restaurant-dashboard/issues/20) | Lost-sale detection |

## Phase 7 — Labor & operations (Milestone 7)

| ID | Issue | Title |
|---|---|---|
| F19 | [#21](https://github.com/vanyanv/restaurant-dashboard/issues/21) | Hourly labor optimization |
| F20 | [#22](https://github.com/vanyanv/restaurant-dashboard/issues/22) | Weather-adjusted prep recommendations |
| F21 | [#23](https://github.com/vanyanv/restaurant-dashboard/issues/23) | Smart contextual alerts |

## Phase 8 — Menu intelligence (Milestone 8)

| ID | Issue | Title |
|---|---|---|
| F22 | [#24](https://github.com/vanyanv/restaurant-dashboard/issues/24) | Menu engineering classifier (Stars/Plowhorses/Puzzles/Dogs) |
| F23 | [#25](https://github.com/vanyanv/restaurant-dashboard/issues/25) | New item launch trajectory |
| F24 | [#26](https://github.com/vanyanv/restaurant-dashboard/issues/26) | Channel mix optimizer |

## Phase 9 — Customer & cash (Milestone 9)

| ID | Issue | Title |
|---|---|---|
| F25 | [#27](https://github.com/vanyanv/restaurant-dashboard/issues/27) | Cash position forecast |
| F26 | [#28](https://github.com/vanyanv/restaurant-dashboard/issues/28) | Catering / bulk-order detection |
| F27 | [#29](https://github.com/vanyanv/restaurant-dashboard/issues/29) | Vendor reliability scoring |

## Phase 10 — Self-improving (Milestone 10)

| ID | Issue | Title |
|---|---|---|
| F28 | [#30](https://github.com/vanyanv/restaurant-dashboard/issues/30) | Auto-completing recipe builder |
| F29 | [#31](https://github.com/vanyanv/restaurant-dashboard/issues/31) | Waste root-cause clustering |

## Working rule

- PR title format: `F2: implement computeRunningOnHand (closes #4)`
- PR body must include `Closes #N` for the corresponding issue
- Phase milestone closes when all its issues close AND the verification gate (in milestone description) is signed off
- Stuck or rescoped items get a comment + relabel, not a silent close
