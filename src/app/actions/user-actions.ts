"use server"

import { z } from "zod"
import bcrypt from "bcryptjs"
import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type ActionResult =
  | { success: true; error?: never }
  | { success?: never; error: string }

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  avatarUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || v === undefined || /^https?:\/\//i.test(v),
      "Avatar must be a full http(s) URL"
    ),
})

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }

    const data = profileSchema.parse({
      name: formData.get("name"),
      phone: formData.get("phone") || undefined,
      timezone: formData.get("timezone"),
      avatarUrl: formData.get("avatarUrl") || undefined,
    })

    await prisma.user.update({
      where: { id: session.user.id },
      data,
    })

    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/settings/account")
    revalidatePath("/dashboard/settings/preferences")
    revalidatePath("/dashboard")
    return { success: true as const }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("updateProfile error:", error)
    return { error: "Could not update profile" }
  }
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(200),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "New password and confirmation do not match",
    path: ["confirmPassword"],
  })

export async function changePassword(formData: FormData): Promise<ActionResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }

    const data = passwordSchema.parse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    })

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    })
    if (!user) return { error: "Account not found" }

    const matches = await bcrypt.compare(data.currentPassword, user.password)
    if (!matches) return { error: "Current password is incorrect" }

    const hashed = await bcrypt.hash(data.newPassword, 10)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashed },
    })

    revalidatePath("/dashboard/settings/account")
    return { success: true as const }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("changePassword error:", error)
    return { error: "Could not change password" }
  }
}

const notificationSchema = z.object({
  notifyInvoices: z.boolean(),
  notifyWeeklyReport: z.boolean(),
  notifyAnomaly: z.boolean(),
})

export async function updateNotificationPrefs(
  formData: FormData
): Promise<ActionResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }

    const data = notificationSchema.parse({
      notifyInvoices: formData.get("notifyInvoices") === "on",
      notifyWeeklyReport: formData.get("notifyWeeklyReport") === "on",
      notifyAnomaly: formData.get("notifyAnomaly") === "on",
    })

    await prisma.user.update({
      where: { id: session.user.id },
      data,
    })

    revalidatePath("/dashboard/settings/notifications")
    return { success: true as const }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("updateNotificationPrefs error:", error)
    return { error: "Could not update notifications" }
  }
}
