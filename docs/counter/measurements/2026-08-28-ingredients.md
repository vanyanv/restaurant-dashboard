# Ingredients, measured before it was built

`P.ingredients` (`docs/counter/counter-prototype.html:5769`) against the live
account, 2026-08-28. 76 canonical ingredients, 1,667 invoice lines, 21 aliases,
119 SKU matches.

---

## 1. The catalogue is frozen, and that is the first strip cell

Every one of the 76 canonical ingredients was created between **19 April and
3 May 2026** — a two-week burst. **None has been created in the thirty days
since**, while 39 invoices arrived.

The prototype's first cell reads `Canonical items 412 · ▲ 8 this month`. Here
the honest delta is `none added in 30 days`, and that is not growth slowing
down: a pipeline that adds nothing while invoices keep arriving either has
nothing new to add, or has stopped. The unmatched queue in §3 says which.

## 2. Auto-match is at 98.6%, not 92.5%

| `matchSource` | lines |
|---|---:|
| `sku` | 1,481 |
| `alias` | 159 |
| `manual` | 3 |
| *(unmatched)* | 24 |

1,643 of 1,667. That is a better number than the prototype's fixture and it is
printed as it stands.

It is **not** the same figure as the 55% in
`project_ingredient_auto_match.md` — that is the SHADOW-mode matcher's accuracy
on genuinely new products, which is a question about the next line, not about
the 1,667 already matched.

## 3. The 24 unmatched lines are 11 products, and 8 of them are one can liner

```
CAN LINER 40X46 1.5MIL BLK CORELESS      $165.34
Can Liner Black Coreless                  $70.76
CAN LINER CLR                             $48.48
Can Liner 40x46 1.5mil Black Coreless     $43.87
CAN LINER 40X46 1.5MIL BLACK CORELESS     $43.87
Can Liner 40x46 1.5Mil Black Coreless     $43.06
CAN LINER                                 $42.22
Can Liner 40x46 1.5 mil Black Coreless    $35.38
                                    ---------
                                         $492.98
```

**Eight spellings, ten lines, $493** — a third of the whole queue, and one
alias clears it. The same shape as the invoice vendors
(`2026-08-28-invoices.md` §3) and the menu's item names
(`2026-08-28-catalog.md` §2): an identity that exists only as a string somebody
typed.

So the review inbox shows **clusters, not lines**, grouped on the first two
words. The work is one alias per product; a list of 24 rows would present the
same decision eight times.

Two more are already-known products under a vendor spelling the alias table
does not carry — `CONT FOAM BAGGED -BF` and `CONT FOAM HNGD WHT`, both from
`IFS INDIVIDUAL FOODSERVICE` rather than `Individual FoodService`. That is the
vendor-name aliasing of the Invoices page reaching one table further in.

The rest are genuinely unlisted: toilet seat covers, nitrile gloves, a register
ribbon, two label rolls, a bagasse bowl. And one row that is not a product at
all: `Total SALES TAX`, −$11.33.

## 4. "Review inbox" has nothing pending in it

`RecipeMappingProposal` holds ten rows and **every one is decided**:

| status | kind | n |
|---|---|---:|
| ACCEPTED | MATCH | 3 |
| REJECTED | MATCH | 4 |
| REJECTED | COMBO_DECOMPOSITION | 2 |
| REJECTED | NEW_RECIPE | 1 |

The prototype's inbox is a queue of AI proposals waiting on Accept / Not this.
There is no such queue here — it has been worked. §3 is what is actually
waiting, so §3 is what the section shows.

## 5. The biggest gap is 43× the one the prototype points at

**43 of the 76 ingredients — 57% — appear in no recipe at all**, and they carry
**$36,589** of purchases:

| | |
|---|---:|
| Container foam hinged white 9x6.5x2.5 | $5,457 |
| Sysco reliable shortening fry liquid clear | $4,456 |
| Hellmann mayonnaise extra heavy | $3,562 |
| Container foam 1-compartment bagged | $3,307 |
| Paper patty 5.5 x 5.5 dry wax | $2,682 |
| Nitrile gloves | $2,200 |
| Syrup lemonade | $2,138 |
| … 36 more | |

Against **$825** of unmatched lines.

Some of that is genuinely not food — foam containers, gloves, paper. Some of it
plainly is: fry shortening, mayonnaise, lemonade syrup. Every one of those is
bought, costed, and reaches no plate, so **every plate cost in this product is
understated by whatever share of $36,589 is food**.

This is not the same denominator as COGS' "99.8% mapped". That measures SOLD
ITEMS reaching a recipe. This measures PURCHASED INGREDIENTS reaching one. Both
are true and they are different questions.

So the prototype's "Needs review" queue leads with this and puts the unmatched
lines second.

## 6. The price monitor cannot be drawn in dollars

The three biggest ingredients by 30-day spend:

| | last price |
|---|---:|
| Ground beef fine grnd 73/27 Creekstone | $4.39 / lb |
| Chris & Eddy's house sauce cup 1.5 oz | $118.71 / cs |
| Lamb potato fry ss 1/4 stealth | $28.00 / cs |

On one dollar axis spanning $4 to $125, **ground beef — the single largest line
in the account — is a flat rule along the bottom** and a 5% move in it is
invisible. The prototype's fixture avoids this by picking three items that all
cost between $2 and $5.

Every series is therefore **indexed to its own first reading** and the axis is
percent. That is also the question the section asks: not which ingredient costs
more per case (the catalogue beside it answers that, in native units) but which
of them is moving. The legend carries the native price.

## 7. A price move measured from two readings is wrong

Fries, measured three ways over the same window:

| method | result |
|---|---|
| Two `unitPrice` readings 30 days apart, same unit | **−40%** |
| Mean `extendedPrice / quantity`, 30d vs prior 30d | **+31%** |
| Eight weekly medians of `unitPrice` | **−13%** |

`unit` is `CS` for all of them and a case is not always the same case. The
mean-of-derived version is worse still: it mixes pack sizes inside each window.

The catalogue's `30d` column therefore reads the **same weekly medians the
chart is drawn from**, so the two cannot disagree — the standing rule that a
figure on two surfaces comes from one function, applied to a figure appearing
twice on one page.

## 8. The pantry's money is concentrated where the costing is not

| Group | Items | Costed | Spend, 30d |
|---|---:|---:|---:|
| Meat | 2 | **1** | $23,807 |
| Uncategorised | 2 | **1** | $12,939 |
| Frozen | 1 | 1 | $7,309 |
| Bakery | 1 | 1 | $7,155 |
| Paper/Supplies | 26 | 23 | $5,620 |

The two groups holding the most money are the two **smallest**, and each has
half its items costed. `Meat` holding two ingredients for $23,807 is the
ground-beef aliasing of `2026-08-28-invoices.md` §4 — four spellings collapsed
by the canonical layer into two rows rather than one.

## 9. Modifiers

The catalogue page already measured these (`2026-08-28-catalog.md`). Restated
for the mapping table: of the top fourteen modifiers by volume over thirty
days, **twelve are mapped and two are not** — `Add Pickles` (2,225 servings)
and `" Add Sauce"` with a leading space (910). Both are whitespace or plural
variants of modifiers that ARE mapped, which is the same one-line `trim()` the
catalogue measurement asked for.

Six of the top seven have **no price at all**. They are free, not unpriced, so
the column says "free" rather than an em-dash — an em-dash in a price column
reads as missing data.
