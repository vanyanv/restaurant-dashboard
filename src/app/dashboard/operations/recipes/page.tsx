import { redirect } from "next/navigation"

// Recipes consolidated onto the canonical /dashboard/recipes surface. This
// legacy operations path now redirects so existing links and bookmarks resolve.
export default function OperationsRecipesPage() {
  redirect("/dashboard/recipes")
}
