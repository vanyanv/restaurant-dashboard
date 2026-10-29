import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { SubmissionContent } from "./data"
import { escapeEmailHtml as esc, sendEmail } from "./email"
import { CHECK_LABEL, clockLabel, dayLabel, dbToDay, type CheckKindName } from "./time"

/**
 * The owners' email for a submitted check: who sent it and when, every task
 * with who did it and at what time, notes, and a link to the photos in the
 * dashboard (photos stay behind the owner sign-in, never in the email).
 * Recipients are the account's `checkReportEmails`, edited on Store checks.
 */

export type CheckReport = { subject: string; text: string; html: string }

export function checkReportContent(r: {
  store: string
  kind: CheckKindName
  day: string
  by: string
  submittedAt: Date
  lateMinutes: number
  content: SubmissionContent
  photoCount: number
  link: string
}): CheckReport {
  const label = CHECK_LABEL[r.kind].en
  const at = clockLabel(r.submittedAt)
  const subject = `${r.store} · ${label} check submitted ${at} by ${r.by}`
  const items = r.content.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.name })))
  const people = [...new Set(items.map((i) => i.by).filter((b): b is string => Boolean(b)))]
  const when = (iso: string | null | undefined) => (iso ? clockLabel(new Date(iso)) : "")
  const flagged = items.filter((i) => i.flag)

  const text = [
    `${label} check · ${r.store} · ${dayLabel(r.day)}`,
    `Submitted ${at} by ${r.by}${r.lateMinutes > 0 ? ` (${r.lateMinutes} min late)` : ""}.`,
    people.length > 0 ? `Done by ${people.join(", ")}.` : "",
    "",
    ...items.map((i) => `${when(i.at).padEnd(9)} ${i.text}${i.by ? ` · ${i.by}` : ""}${i.photo ? " · photo" : ""}${i.flag ? ` · NOTE: ${i.flag}` : ""}`),
    "",
    r.photoCount > 0 ? `${r.photoCount} photo${r.photoCount === 1 ? "" : "s"}: ${r.link}` : `Open in the dashboard: ${r.link}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n")

  const rows = items
    .map(
      (i) => `<tr>
<td style="padding:6px 10px 6px 0;color:#6b604f;font-family:monospace;white-space:nowrap;vertical-align:top">${esc(when(i.at))}</td>
<td style="padding:6px 10px 6px 0;vertical-align:top">${esc(i.text)}${i.flag ? `<br><span style="color:#b41d14">Note: ${esc(i.flag)}</span>` : ""}</td>
<td style="padding:6px 10px 6px 0;color:#6b604f;white-space:nowrap;vertical-align:top">${esc(i.by ?? "")}</td>
<td style="padding:6px 0;color:#6b604f;vertical-align:top">${i.photo ? "Photo" : ""}</td>
</tr>`,
    )
    .join("")
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1612;max-width:560px">
<div style="background:#e63027;color:#fff2c9;padding:14px 16px;font-weight:bold;letter-spacing:1px">${esc(r.store.toUpperCase())} · ${esc(label.toUpperCase())} CHECK</div>
<p style="margin:16px 0 4px"><b>Submitted ${esc(at)}</b> by ${esc(r.by)} · ${esc(dayLabel(r.day))}${r.lateMinutes > 0 ? ` · ${r.lateMinutes} min late` : ""}</p>
${people.length > 0 ? `<p style="margin:0 0 12px;color:#6b604f">Done by ${esc(people.join(", "))}</p>` : ""}
${flagged.length > 0 ? `<p style="margin:0 0 12px;color:#b41d14"><b>${flagged.length} task${flagged.length === 1 ? "" : "s"} need${flagged.length === 1 ? "s" : ""} attention.</b></p>` : ""}
<table style="border-collapse:collapse;width:100%;font-size:14px;border-top:1px solid #e3d8bc">${rows}</table>
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
    content: sub.content as SubmissionContent,
    photoCount: sub._count.photos,
    link: `${dashboardBase()}/dashboard/checks/history?store=${encodeURIComponent(sub.storeId)}&day=${day}&kind=${sub.kind}`,
  })
  const r = await sendEmail({ to, ...report })
  if (!r.ok) logger.warn("[checks.report] not sent", { submissionId, reason: r.reason })
}
