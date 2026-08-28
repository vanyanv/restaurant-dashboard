/**
 * Re-export shim. The implementation moved to `src/lib/ingredient-picker-utils`
 * when the Counter rebuild retired `/dashboard/recipes`.
 *
 * It stays reachable at this path on purpose. Three surviving surfaces import
 * it — a server action, the ingredient-audit log and the price monitor — and
 * none of them is a recipe page; the util was only ever here by accident of
 * where it was first written. Repointing their imports would edit three files
 * under `src/app/dashboard/**`, and the Counter linter keys its legacy
 * exemption to a file's bytes being unchanged, so a one-line import edit would
 * demand a full Counter rebuild of a monitoring page nobody asked for.
 *
 * No `"use server"` here — it breaks Next.js re-exports
 * (`docs/refactor-playbook.md`).
 *
 * Delete this file when the last of those three is rebuilt.
 */
export * from "@/lib/ingredient-picker-utils"
