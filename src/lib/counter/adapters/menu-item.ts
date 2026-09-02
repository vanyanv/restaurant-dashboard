import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { count, money, pct } from "@/lib/counter/format"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { CHANNEL_FOR_PLATFORM, HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"
import { channelById, type ChannelId } from "@/lib/counter/channels"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow } from "@/components/counter"

/**
 * One POS item — `P.catalogitem`
 * (`docs/counter/counter-prototype.html:6930`).
 *
 * "How it sells, what it costs, and which recipe is behind it."
 *
 * ## COMMISSION IS NOT RECORDED, AND THAT IS HALF THIS PAGE'S PROTOTYPE
 *
 * `P.catalogitem` asks for **Charged**, **Kept**, "$X to the marketplaces",
 * and a channel table with **Commission** and **Net each** columns. All of it
 * comes from `OtterOrder.commission`, and measured on 2026-08-28:
 *
 *   - 25,648 orders carry a commission ALL TIME,
 *   - **zero of the 10,339 orders in the trailing thirty days do**,
 *   - the last order carrying one is dated **2026-07-22**,
 *   - and two earlier whole months are empty the same way, so this is
 *     intermittent rather than a clean cutoff.
 *
 * `detailsFetchedAt` is set on 10,334 of those 10,339, so the details WERE
 * fetched and came back without a commission. Nothing here can repair that.
 *
 * The Orders page already met this and already answered it: an em dash and
 * "not recorded for this range", never a zero. `money(null)` is an em dash for
 * exactly this reason — **`$0.00` in a fee column is the claim that the
 * marketplaces took nothing**, which is a far worse error than an absence.
 * This page uses the same words for the same gap, because a reader who sees
 * "not recorded" on two pages has learned one fact, and a reader who sees it
 * once and a zero once has learned something false.
 *
 * ## What the channel table CAN say
 *
 * `OtterOrderItem` joins `OtterOrder.platform`, so units and revenue per
 * channel per item are real and measured — 3,782 of the flagship slider on
 * Uber Eats, 3,293 on DoorDash, 29 on Grubhub. Price is revenue over units.
 * Margin is against the PLATE cost, which does not vary by channel, so the
 * column reads what the kitchen keeps before the marketplace takes its share
 * — and the column header says so rather than implying a net margin nobody
 * can compute.
 *
 * ## The route is keyed by the item's NAME, not a recipe id
 *
 * The page the prototype draws is about a POS item; the recipe is one of the
 * things it reports. The editorial page at this path took a recipe id, so an
 * item with no recipe had no page at all — which is precisely the item this
 * page is most useful for.
 */

export interface ItemHeadline {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface ItemSeries {
  chart: ChartSpec
  meta: string
}

export interface ItemChannelRow {
  key: string
  channel: string
  /** A `--ch-*` custom property NAME for the chip's tint. */
  tint: string
  price: string
  sold: string
  commission: string
  netEach: string
  margin: string
}

export interface ItemChannels {
  rows: ItemChannelRow[]
  phoneRows: MListRow[]
  meta: string
  /** Why two columns read the same three words on every row. */
  note: string
}

export interface ItemBehindRow {
  key: string
  title: string
  detail: string
  mapped: boolean
}

export interface ItemBehind {
  rows: ItemBehindRow[]
  actions: { label: string; href: string; primary?: boolean }[]
  meta: string
  /**
   * WHAT THIS SECTION CAN NOW DO, AND WHY IT MATTERS MORE THAN ITS SIZE.
   *
   * A recipe mapped to an Otter item is what makes a plate cost, a margin and
   * a COGS attribution possible for it. Measured on this account: **60 of 155
   * distinct sold item names are mapped — 39%.** The other 95 sell every day
   * and cost nothing the product can see, so they are absent from margin, from
   * menu engineering, and from the food-cost figures that are drawn against
   * the target.
   *
   * `mapOtterItemToRecipe` has always existed and the editorial recipe canvas
   * called it. The Counter rebuild's only control here was a button reading
   * "Map N of these modifiers" that navigated to `/dashboard/recipes` and
   * mapped nothing.
   *
   * The mapping is written for EVERY store on the account, which is the
   * action's own behaviour and the right one: an item name is the POS's, not a
   * location's, and a recipe mapped at Hollywood and not at Glendale would
   * make the same burger costed in one place and free in the other.
   */
  otterItemName: string
  /** Whether a recipe is already mapped — the button says map or change. */
  mapped: boolean
  /** Every recipe on the account, for the picker. */
  recipes: Array<{ id: string; name: string }>
  /**
   * How many modifiers sold with this item have no recipe.
   *
   * Stated, not offered. `mapOtterSubItemToRecipe` needs a `skuId` that this
   * page does not carry, so a control here would be a button that could not
   * complete — the thing this codebase does not ship. The note says the number
   * so the gap is visible rather than silent.
   */
  unmappedModifiers: number
}

export interface MenuItemSections {
  headline: SectionData<ItemHeadline>
  series: SectionData<ItemSeries>
  channels: SectionData<ItemChannels>
  behind: SectionData<ItemBehind>
}

export interface MenuItemInput {
  slug: string
  range: DateRange
  storeId: string | null
  accountId: string
}

/** Modifiers listed under "Behind it" before the row stops naming them. */
const MAX_MODIFIERS = 6

/**
 * The same slug the catalog table builds its links from. Not injective in
 * principle; in practice this menu's sixty-one names produce sixty-one slugs,
 * and a collision resolves to the better-selling item rather than a 404.
 */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

interface ItemData {
  name: string
  categories: string[]
  qty: number
  revenue: number
  daily: { date: string; qty: number }[]
  plateCost: number | null
  margin: number | null
  mapped: boolean
  recipeLines: number | null
  byChannel: { channel: ChannelId; qty: number; revenue: number }[]
  modifiers: { name: string; qty: number; revenue: number; mapped: boolean }[]
  /** True when ANY order in the window carries a commission. Measured: false. */
  feesRecorded: boolean
  /** How many item names sell on BOTH the in-house POS and a marketplace. */
  namesOnBoth: number
  /** How many item names the order feed carries at all, in this window. */
  namesTotal: number
  /** Every recipe on the account, for the mapping picker. */
  recipes: Array<{ id: string; name: string }>
}

async function loadItem(input: MenuItemInput): Promise<ItemData | null> {
  const { slug, range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return null

  const where = { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } }

  // The slug is resolved against what actually SOLD in the window, because
  // that is what every other figure on this page is scoped to. An item that
  // sold nothing here has no page here.
  const sold = await prisma.otterMenuItem.findMany({
    where: { ...where, isModifier: false },
    select: {
      itemName: true,
      category: true,
      date: true,
      fpQuantitySold: true,
      tpQuantitySold: true,
      fpTotalSales: true,
      tpTotalSales: true,
    },
  })
  const mine = sold.filter((r) => slugOf(r.itemName) === slug)
  if (mine.length === 0) return null
  const name = mine[0].itemName

  const daily = new Map<string, number>()
  const categories = new Set<string>()
  let qty = 0
  let revenue = 0
  for (const r of mine) {
    const q = Number(r.fpQuantitySold ?? 0) + Number(r.tpQuantitySold ?? 0)
    qty += q
    revenue += Number(r.fpTotalSales ?? 0) + Number(r.tpTotalSales ?? 0)
    categories.add(r.category?.trim() ? r.category.trim() : "Uncategorized")
    const key = r.date.toISOString().slice(0, 10)
    daily.set(key, (daily.get(key) ?? 0) + q)
  }

  const [cost, mapping, channelRows, modifierRows, feeCount, nameSpread, recipeList] =
    await Promise.all([
    prisma.dailyCogsItem.aggregate({
      where: { ...where, itemName: name },
      _sum: { lineCost: true, salesRevenue: true, qtySold: true },
    }),
    prisma.otterItemMapping.findFirst({
      where: { storeId: { in: storeIds }, otterItemName: name },
      select: { recipeId: true },
    }),
    prisma.$queryRaw<{ platform: string; qty: number; revenue: number }[]>`
      SELECT o."platform" AS platform,
             SUM(i."quantity")::float AS qty,
             SUM(i."price" * i."quantity")::float AS revenue
      FROM "OtterOrderItem" i
      JOIN "OtterOrder" o ON o."id" = i."orderId"
      WHERE o."storeId" = ANY(${storeIds})
        AND o."referenceTimeLocal" BETWEEN ${startDate} AND ${endDate}
        AND i."name" = ${name}
      GROUP BY o."platform"`,
    prisma.$queryRaw<{ name: string; qty: number; revenue: number }[]>`
      SELECT s."name" AS name,
             SUM(s."quantity")::float AS qty,
             SUM(s."price" * s."quantity")::float AS revenue
      FROM "OtterOrderSubItem" s
      JOIN "OtterOrderItem" i ON i."id" = s."orderItemId"
      JOIN "OtterOrder" o ON o."id" = i."orderId"
      WHERE o."storeId" = ANY(${storeIds})
        AND o."referenceTimeLocal" BETWEEN ${startDate} AND ${endDate}
        AND i."name" = ${name}
      GROUP BY s."name"
      ORDER BY 2 DESC
      LIMIT ${MAX_MODIFIERS}`,
    prisma.otterOrder.count({
      where: {
        storeId: { in: storeIds },
        referenceTimeLocal: { gte: startDate, lte: endDate },
        commission: { not: 0 },
      },
    }),
    // Every item name in the window with the two facts that matter: whether
    // it ever sold in-house and whether it ever sold on a marketplace. One
    // grouped scan, and it is what tells this page that a name showing three
    // marketplace channels is not the whole story.
    prisma.$queryRaw<{ name: string; house: boolean; market: boolean }[]>`
      SELECT i."name" AS name,
             bool_or(o."platform" = ANY(${HOUSE_PLATFORMS as string[]})) AS house,
             bool_or(NOT (o."platform" = ANY(${HOUSE_PLATFORMS as string[]}))) AS market
      FROM "OtterOrderItem" i
      JOIN "OtterOrder" o ON o."id" = i."orderId"
      WHERE o."storeId" = ANY(${storeIds})
        AND o."referenceTimeLocal" BETWEEN ${startDate} AND ${endDate}
      GROUP BY i."name"`,
    // The picker's options. Every recipe on the account, not only the sellable
    // ones: an item can legitimately map to a component recipe, and hiding
    // those would make some mappings impossible to express here.
    prisma.recipe.findMany({
      where: { accountId },
      select: { id: true, itemName: true },
      orderBy: { itemName: "asc" },
    }),
  ])

  const mappedModifiers = new Set(
    (
      await prisma.otterSubItemMapping.findMany({
        where: {
          storeId: { in: storeIds },
          otterSubItemName: { in: modifierRows.map((m) => m.name) },
        },
        select: { otterSubItemName: true },
      })
    ).map((m) => m.otterSubItemName),
  )

  const lineCost = Number(cost._sum.lineCost ?? 0)
  const costRevenue = Number(cost._sum.salesRevenue ?? 0)
  const costQty = Number(cost._sum.qtySold ?? 0)

  // Channels the map does not name are LEFT OUT, not folded into house — the
  // rule `channel-mix.ts` states: folding a marketplace into the house channel
  // would report its volume as commission-free.
  const byChannel = new Map<ChannelId, { qty: number; revenue: number }>()
  for (const r of channelRows) {
    const channel = CHANNEL_FOR_PLATFORM[r.platform]
    if (!channel) continue
    const acc = byChannel.get(channel) ?? { qty: 0, revenue: 0 }
    acc.qty += Number(r.qty)
    acc.revenue += Number(r.revenue)
    byChannel.set(channel, acc)
  }

  return {
    name,
    categories: [...categories].sort(),
    qty,
    revenue,
    daily: [...daily.entries()].sort().map(([date, q]) => ({ date, qty: q })),
    plateCost: costQty > 0 ? lineCost / costQty : null,
    margin: costRevenue > 0 ? 100 - (lineCost / costRevenue) * 100 : null,
    mapped: mapping !== null,
    recipeLines: null,
    byChannel: [...byChannel.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.qty - a.qty),
    modifiers: modifierRows.map((m) => ({
      name: m.name,
      qty: Number(m.qty),
      revenue: Number(m.revenue),
      mapped: mappedModifiers.has(m.name),
    })),
    feesRecorded: feeCount > 0,
    namesOnBoth: nameSpread.filter((r) => r.house && r.market).length,
    namesTotal: nameSpread.length,
    recipes: recipeList.map((r) => ({ id: r.id, name: r.itemName })),
  }
}

/** The Orders page's own words for the same gap, in one place. */
const FEES_ABSENT = "not recorded for this range"

const plural = (n: number, one: string, many: string) =>
  `${count(n)} ${n === 1 ? one : many}`

function headlineOf(d: ItemData): ItemHeadline {
  const soldCell: FigureProps = {
    label: "Sold",
    value: count(d.qty),
    delta: "in this range",
    deltaTone: "is-flat",
  }
  const marginCell: FigureProps = {
    label: "Counter margin",
    value: d.margin === null ? "—" : pct(d.margin, { scaled: true }),
    delta: d.margin === null ? "no costed sales" : "before the marketplace's share",
    deltaTone: "is-flat",
  }

  return {
    title: d.name,
    sub: `${d.categories.join(" · ")} · ${plural(d.byChannel.length, "channel", "channels")}`,
    cells: [
      soldCell,
      { label: "Charged", value: money(d.revenue), delta: "before commission", deltaTone: "is-flat" },
      {
        label: "Kept",
        // NOT `money(d.revenue)`. With no commission on file "Kept" would
        // equal "Charged" and the page would assert the marketplaces took
        // nothing — see the docblock.
        value: d.feesRecorded ? money(d.revenue) : "—",
        delta: d.feesRecorded ? "after commission" : FEES_ABSENT,
        deltaTone: "is-flat",
      },
      {
        label: "Plate cost",
        value: d.plateCost === null ? "—" : money(d.plateCost, { cents: true }),
        delta: d.plateCost === null ? "no recipe costed it" : "per unit sold",
        deltaTone: "is-flat",
      },
      marginCell,
    ],
    phoneCells: [soldCell, marginCell],
  }
}

function seriesOf(d: ItemData): ItemSeries {
  return {
    chart: {
      type: "bars",
      h: 148,
      zero: true,
      labels: d.daily.map((r) => r.date.slice(5)),
      series: [{ name: "Units", color: "var(--ink)", data: d.daily.map((r) => r.qty) }],
      alt: `${d.name} units sold`,
    },
    meta: `${count(d.qty)} over ${count(d.daily.length)} days`,
  }
}

function channelsOf(d: ItemData): ItemChannels {
  const feedQty = d.byChannel.reduce((t, c) => t + c.qty, 0)
  const feedGap = d.qty > 0 ? (feedQty - d.qty) / d.qty : 0
  const sellsInHouse = d.byChannel.some((c) => c.channel === "house")
  const marketOnly = !sellsInHouse && d.byChannel.length > 0
  const rows: ItemChannelRow[] = d.byChannel.map((c) => {
    const meta = channelById(c.channel)
    const price = c.qty > 0 ? c.revenue / c.qty : 0
    // Against the PLATE cost, which does not vary by channel. This is what the
    // kitchen keeps before the marketplace takes its share, and the column
    // header says exactly that.
    const margin =
      d.plateCost !== null && price > 0 ? 100 - (d.plateCost / price) * 100 : null
    return {
      key: c.channel,
      channel: meta.name,
      tint: meta.markVar,
      price: money(price, { cents: true }),
      sold: count(c.qty),
      commission: d.feesRecorded ? money(0) : FEES_ABSENT,
      netEach: d.feesRecorded ? money(price, { cents: true }) : FEES_ABSENT,
      margin: margin === null ? "—" : pct(margin, { scaled: true }),
    }
  })

  return {
    rows,
    phoneRows: d.byChannel.map((c) => {
      const meta = channelById(c.channel)
      const price = c.qty > 0 ? c.revenue / c.qty : 0
      return {
        key: c.channel,
        title: meta.name,
        detail: `${count(c.qty)} sold`,
        value: money(price, { cents: true }),
        note: "each",
      }
    }),
    meta: `${plural(d.byChannel.length, "channel", "channels")} · by units`,
    note:
      // Two counts of the same item, both labelled Sold, one on top of the
      // other. `feedQty` is the ORDER feed; the strip is the POS's daily
      // rollup, which is what the catalog, Menu profit and the Menu hub all
      // read. Measured across the twelve biggest sellers the feed runs 1.5% to
      // 4.3% high, ~2.5% overall, on EVERY item — systematic, not noise — and
      // cancelled orders do not explain it: all 1,625 Sodas on the feed are
      // fulfilled. Nothing here can reconcile two of Otter's own feeds, so the
      // page says which one it is reading, the way the COGS items table
      // already says its rows do not sum to the figure above.
      // The channel list is BY ITEM NAME, and on this account the in-house
      // POS and the marketplaces use different names for the same food —
      // "Double Slider" in-house against "Signature Double Patty & Cheese
      // Slider (Chris' or Eddy's Way)" on the marketplaces. Measured, only
      // two of fifty-five names sell on both. A reader looking at three
      // marketplace rows would otherwise conclude this item is not sold in
      // the restaurant.
      (marketOnly
        ? `This name sells only on the marketplaces. The in-house POS uses DIFFERENT names ` +
          `for the same food — only ${count(d.namesOnBoth)} of ${count(d.namesTotal)} names on ` +
          `this account sell on both — so the same item is very likely in the restaurant under ` +
          `another name, and no figure here includes it. `
        : sellsInHouse && d.byChannel.length === 1
          ? `This name sells only in-house, and only ${count(d.namesOnBoth)} of ` +
            `${count(d.namesTotal)} names on this account sell on both the POS and a ` +
            `marketplace — so the marketplaces very likely carry the same food under another ` +
            `name. `
          : "") +
      `The Sold column counts the ORDER feed; the figure above counts the POS's daily ` +
      `rollup, which every other menu page reads. The feed runs about ` +
      `${pct(feedGap * 100, { scaled: true })} high on this item and does so on every ` +
      `item — cancelled orders do not account for it. ` +
      (d.feesRecorded
        ? "Margin is against the plate cost, which does not vary by channel."
        : `Commission and Net each read "${FEES_ABSENT}" because no order in this window ` +
          `carries one — the last that did is dated 22 Jul. A zero there would say the ` +
          `marketplaces took nothing. Margin is against the PLATE cost, which does not ` +
          `vary by channel, so it is what the kitchen keeps before the marketplace's share.`),
  }
}

function behindOf(d: ItemData): ItemBehind {
  const rows: ItemBehindRow[] = [
    {
      key: "recipe",
      title: d.name,
      detail: d.mapped ? "Recipe · mapped to this item" : "No recipe is mapped to this item",
      mapped: d.mapped,
    },
    ...d.modifiers.map((m) => ({
      key: `mod-${m.name}`,
      title: m.name,
      detail:
        `Modifier · ${count(m.qty)} sold · ` +
        (m.revenue > 0 ? money(m.revenue / m.qty, { cents: true }) : "free"),
      mapped: m.mapped,
    })),
  ]

  const unmapped = d.modifiers.filter((m) => !m.mapped)
  return {
    rows,
    otterItemName: d.name,
    mapped: d.mapped,
    recipes: d.recipes,
    /*
     * ONE LINK, NOT TWO. The primary used to read "Map N of these modifiers"
     * or "Open the recipe" and both went to `/dashboard/recipes`, mapping
     * nothing. The primary slot is now a real control that writes the mapping
     * (see the client's `BehindMapper`), so the only action left to link is
     * the way back. `unmapped` is still counted, because the note says how
     * many modifiers are unmapped even though mapping one needs a SKU this
     * page does not carry.
     */
    actions: [{ label: "Back to the catalog", href: "/dashboard/menu/catalog" }],
    unmappedModifiers: unmapped.length,
    meta:
      d.modifiers.length === 0
        ? "the recipe · no modifiers sold with it"
        : `recipe and ${plural(d.modifiers.length, "modifier", "modifiers")}`,
  }
}

export function getMenuItemSectionPromises(
  input: MenuItemInput,
): StreamedSections<MenuItemSections> {
  const dataP = classify(
    async () => {
      const d = await loadItem(input)
      if (!d) throw new Error("item not found in this range")
      return d
    },
    { retryAction: "retryMenuItem", isEmpty: (d) => d.qty === 0, emptyReason: "no_match" },
  )

  return {
    headline: guardSection(dataP.then((sd) => mapReady(sd, headlineOf)), "retryMenuItem"),
    series: guardSection(dataP.then((sd) => mapReady(sd, seriesOf)), "retryMenuItem"),
    channels: guardSection(dataP.then((sd) => mapReady(sd, channelsOf)), "retryMenuItem"),
    behind: guardSection(dataP.then((sd) => mapReady(sd, behindOf)), "retryMenuItem"),
  }
}

export async function getMenuItemSections(
  input: MenuItemInput,
): Promise<MenuItemSections> {
  return awaitSections(getMenuItemSectionPromises(input))
}
