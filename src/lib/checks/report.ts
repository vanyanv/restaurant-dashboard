import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { SubmissionContent } from "./data"
import { escapeEmailHtml as esc, sendEmail } from "./email"
import { CHECK_LABEL, clockLabel, dayLabel, dbToDay, windowBounds, type CheckKindName } from "./time"

/**
 * The owners' email for a check, sent by crew or closed by the app when its
 * window ended: how many tasks were done, then the tasks nobody ticked (by
 * section), then notes and tasks ticked after the due time, then every done
 * task with who ticked it and when, and a link to the photos in the
 * dashboard (photos stay behind the owner sign-in, never in the email).
 * Recipients are the account's `checkReportEmails`, edited on Store checks.
 */

export type CheckReport = { subject: string; text: string; html: string }

type ReportItem = { section: string; text: string; done: boolean; flag: string | null; by: string | null; at: string | null; photo: boolean }

export function checkReportContent(r: {
  store: string
  kind: CheckKindName
  day: string
  /** Who pressed Submit; ignored when the check closed itself. */
  by: string
  submittedAt: Date
  lateMinutes: number
  /** The check closed itself when its window ended. */
  autoClosed?: boolean
  /** The due time, so tasks ticked after it can be called late. */
  dueAt?: Date | null
  content: SubmissionContent
  photoCount: number
  link: string
}): CheckReport {
  const label = CHECK_LABEL[r.kind].en
  const at = clockLabel(r.submittedAt)
  const items: ReportItem[] = r.content.sections.flatMap((s) =>
    s.items.map((i) => ({ section: s.name, text: i.text, done: i.done, flag: i.flag, by: i.by ?? null, at: i.at ?? null, photo: Boolean(i.photo) })),
  )
  const total = items.length
  const done = items.filter((i) => i.done)
  const missed = items.filter((i) => !i.done)
  const people = [...new Set(done.map((i) => i.by).filter((b): b is string => Boolean(b)))]
  const when = (iso: string | null) => (iso ? clockLabel(new Date(iso)) : "")
  const isLate = (i: ReportItem) => Boolean(r.dueAt && i.at && new Date(i.at).getTime() > r.dueAt.getTime())
  const attention = done.filter((i) => i.flag || isLate(i))

  const score =
    missed.length === 0
      ? `all ${total} done`
      : done.length === 0
        ? `not started, all ${total} missed`
        : `${done.length} of ${total} done, ${missed.length} missed`
  const subject = r.autoClosed
    ? `${r.store} · ${label} check: ${score}`
    : `${r.store} · ${label} check: ${score}, sent ${at} by ${r.by}`
  const how = r.autoClosed
    ? `Closed itself at ${at}.`
    : `Submitted ${at} by ${r.by}${r.lateMinutes > 0 ? ` (${r.lateMinutes} min late)` : ""}.`
  const headline = missed.length === 0 ? `All ${total} done` : done.length === 0 ? `Not started · all ${total} missed` : `${done.length} of ${total} done · ${missed.length} missed`
  const doneLine = (i: ReportItem) =>
    `${when(i.at).padEnd(9)} ${i.text}${i.by ? ` · ${i.by}` : ""}${i.photo ? " · photo" : ""}${isLate(i) ? " · late" : ""}${i.flag ? ` · NOTE: ${i.flag}` : ""}`

  const text = [
    `${label} check · ${r.store} · ${dayLabel(r.day)}`,
    headline,
    how,
    people.length > 0 ? `Ticked by ${people.join(", ")}.` : "",
    "",
    ...(missed.length > 0 && done.length > 0 ? [`MISSED (${missed.length})`, ...missed.map((i) => `${i.section.padEnd(16)} ${i.text}`), ""] : []),
    ...(attention.length > 0 ? [`NOTES AND LATE TASKS (${attention.length})`, ...attention.map(doneLine), ""] : []),
    ...(done.length > 0 ? [`DONE (${done.length})`, ...done.map(doneLine), ""] : []),
    r.photoCount > 0 ? `${r.photoCount} photo${r.photoCount === 1 ? "" : "s"}: ${r.link}` : `Open in the dashboard: ${r.link}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n")

  const cell = "padding:6px 10px 6px 0;vertical-align:top"
  const dim = "color:#6b604f"
  const doneRows = (list: ReportItem[]) =>
    list
      .map(
        (i) => `<tr>
<td style="${cell};${dim};font-family:monospace;white-space:nowrap">${esc(when(i.at))}</td>
<td style="${cell}">${esc(i.text)}${isLate(i) ? ` <span style="color:#8a5a00">· late</span>` : ""}${i.flag ? `<br><span style="color:#b41d14">Note: ${esc(i.flag)}</span>` : ""}</td>
<td style="${cell};${dim};white-space:nowrap">${esc(i.by ?? "")}</td>
<td style="padding:6px 0;${dim};vertical-align:top">${i.photo ? "Photo" : ""}</td>
</tr>`,
      )
      .join("")
  const missedRows = missed
    .map(
      (i) => `<tr>
<td style="${cell};white-space:nowrap">${esc(i.section)}</td>
<td style="padding:6px 0;vertical-align:top;font-weight:bold">${esc(i.text)}</td>
</tr>`,
    )
    .join("")
  const heading = (t: string, color = "#1a1612") => `<p style="margin:18px 0 6px;font-weight:bold;color:${color}">${t}</p>`
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1612;max-width:560px">
<div style="background:#e63027;color:#fff2c9;padding:14px 16px;font-weight:bold;letter-spacing:1px">${esc(r.store.toUpperCase())} · ${esc(label.toUpperCase())} CHECK</div>
<p style="margin:16px 0 4px;font-size:18px"><b>${esc(headline)}</b> · ${esc(dayLabel(r.day))}</p>
<p style="margin:0 0 4px;${dim}">${esc(how)}</p>
${people.length > 0 ? `<p style="margin:0 0 12px;${dim}">Ticked by ${esc(people.join(", "))}</p>` : ""}
${missed.length > 0 && done.length > 0 ? `${heading(`Missed (${missed.length})`, "#b41d14")}<table style="border-collapse:collapse;width:100%;font-size:14px;background:#fdeeea;color:#b41d14">${missedRows}</table>` : ""}
${attention.length > 0 ? `${heading(`Notes and late tasks (${attention.length})`)}<table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #e3d8bc">${doneRows(attention)}</table>` : ""}
${done.length > 0 ? `${heading(`Done (${done.length})`)}<table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #e3d8bc">${doneRows(done)}</table>` : ""}
<p style="margin:16px 0"><a href="${esc(r.link)}" style="background:#f5b82e;color:#1a1612;padding:10px 14px;text-decoration:none;font-weight:bold">${r.photoCount > 0 ? `See ${r.photoCount} photo${r.photoCount === 1 ? "" : "s"}` : "Open in the dashboard"}</a></p>
</div>`
  return { subject, text, html }
}

function dashboardBase(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

export async function sendCheckReport(submissionId: string): Promise<void> {
  const sub = await prisma.checkSubmission.findUnique({
    where: { id: submissionId },
    select: {
      storeId: true, kind: true, businessDate: true, crewName: true, submittedAt: true, lateMinutes: true, content: true,
      autoClosed: true,
      template: { select: { opensAtMin: true, submitFromMin: true, dueAtMin: true, dueByWeekday: true, graceMin: true } },
      _count: { select: { photos: true } },
      store: { select: { name: true, account: { select: { checkReportEmails: true } } } },
    },
  })
  if (!sub) return
  const to = sub.store.account.checkReportEmails
  if (to.length === 0) return
  const day = dbToDay(sub.businessDate)
  const report = checkReportContent({
    store: sub.store.name,
    kind: sub.kind as CheckKindName,
    day,
    by: sub.crewName,
    submittedAt: sub.submittedAt,
    lateMinutes: sub.lateMinutes,
    autoClosed: sub.autoClosed,
    dueAt: windowBounds(day, sub.template).due,
    content: sub.content as SubmissionContent,
    photoCount: sub._count.photos,
    link: `${dashboardBase()}/dashboard/checks/history?store=${encodeURIComponent(sub.storeId)}&day=${day}&kind=${sub.kind}`,
  })
  const r = await sendEmail({ to, ...report })
  if (!r.ok) logger.warn("[checks.report] not sent", { submissionId, reason: r.reason })
}
