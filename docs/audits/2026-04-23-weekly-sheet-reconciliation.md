# Weekly Sheet Reconciliation

**Store:** Hollywood (cmexd4zia0001jr04ljkdt9na)
**Sheet week (Mon-Sun):** 2025-04-28 → 2025-05-04  (xlsx col BA)
**Dashboard week (Sun-Sat):** 2025-04-27 → 2025-05-03

## Sales reconciliation

Two dashboard columns are shown: one using the **same Mon-Sun days as the sheet** (apples-to-apples), and one using the **dashboard's Sun-Sat week** (what the live P&L page displays). If these two deltas differ, the week-boundary (weekStartsOn) is doing the damage.

| GL   | Line                     | Sheet       | Dash Mon-Sun | Dash Sun-Sat | Δ Mon-Sun  | Δ Sun-Sat  | Note |
|------|--------------------------|-------------|--------------|--------------|------------|------------|------|
| 4010 | Credit Cards (CSS-POS)   |  $ 16531.86 |  $   680.10  |  $   815.04  | -$ 15851.76 | -$ 15716.82 | >5% drift vs aligned |
| 4011 | Cash (CSS-POS)           |  $  5199.36 |  $     0.00  |  $     0.00  | -$  5199.36 | -$  5199.36 | >5% drift vs aligned |
| 4012 | Uber                     |  $ 15877.67 |  $ 30808.78  |  $ 30464.23  |  $ 14931.11 |  $ 14586.56 | >5% drift vs aligned |
| 4013 | DoorDash                 |  $  5136.84 |  $  6916.78  |  $  7046.32  |  $  1779.94 |  $  1909.48 | >5% drift vs aligned |
| 4014 | Grubhub                  |  $   660.97 |  $   791.97  |  $   707.49  |  $   131.00 |  $    46.52 | >5% drift vs aligned |
| 4015 | ChowNow                  |  $     0.00 |  $     0.00  |  $     0.00  |  $     0.00 |  $     0.00 |  |
| 4016 | EZ Cater                 |  $     0.00 |  $     0.00  |  $     0.00  |  $     0.00 |  $     0.00 |  |
| 4017 | Fooda                    |  $     0.00 |  $     0.00  |  $     0.00  |  $     0.00 |  $     0.00 |  |
| 4020 | Beverage                 |  $     0.00 |  $     0.00  |  $     0.00  |  $     0.00 |  $     0.00 |  |
| 4040 | Service Charge           |  $     0.00 |  $   169.40  |  $   147.44  |  $   169.40 |  $   147.44 |  |
| 4100 | Sales Tax (neg)          | -$  2064.47 | -$  2719.89  | -$  2704.72  | -$   655.42 | -$   640.25 | >5% drift vs aligned |
| 4110 | Guest Discounts (neg)    |  $     0.00 |  $ 12174.09  |  $ 12153.70  |  $ 12174.09 |  $ 12153.70 |  |
| —    | **Total Sales (net-of-tax)** | ** $ 42086.03** | ** $ 48821.23**  | ** $ 48629.50**  | ** $  6735.20** | ** $  6543.47** |  |

**Extras (no sheet equivalent):**
- Dashboard FP Net Sales (Mon-Sun):   $   680.10   Orders: 0
- Dashboard TP Net Sales (Mon-Sun):   $ 26038.70   Orders: 0
- Uber commission implied by sheet gross @ default 21%: -$  3334.31 (not shown on sheet)
- DoorDash commission implied by sheet gross @ default 25%: -$  1284.21 (not shown on sheet)

## COGS — purchases vs usage (not directly comparable)

The sheet books COGS as **vendor invoices received** during the week. The dashboard books COGS as **recipe cost × qty sold** materialised into `DailyCogsItem`. These are fundamentally different metrics — purchases are spiky (delivery schedules), usage is smooth (daily sales). They converge only over full inventory periods with opening/closing inventory adjustments. Week-level variance is expected and is **not** evidence of a bug on either side.

**Sheet — COGS by vendor (Mon-Sun 2025-04-28..2025-05-04)**

| GL   | Vendor             | Amount       |
|------|--------------------|--------------|
| 5010 | Shamrock           |  $     0.00 |
| 5011 | IFS                |  $     0.00 |
| 5012 | K&K                |  $     0.00 |
| 5013 | Restaurant Depot   |  $     0.00 |
| 5014 | Smart and Final    |  $     0.00 |
| 5015 | Sysco              |  $ 13030.54 |
| —    | **Sheet total**    | ** $ 13030.54** |

**Dashboard — vendor invoices with invoiceDate in the same Mon-Sun range**

_No invoices in this date range._

**Dashboard — recipe-based COGS (usage) for Mon-Sun range**

- Total recipe COGS:         $     0.00
- DailyCogsItem rows COSTED:       0
- DailyCogsItem rows UNMAPPED:     0  (revenue share   0.0%)
- DailyCogsItem rows MISSING_COST: 0

## Verdict

- Sales differ by  $  6735.20 on the Mon-Sun basis — not explained by the week-boundary alone. Investigate: missing platforms (EZ Cater $0.00, Fooda $0.00), discount/tax timing, 3P fee treatment.
- COGS comparison is **advisory only**. Purchases ≠ usage. Don't expect week-to-week agreement.
