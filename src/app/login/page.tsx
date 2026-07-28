import type { Metadata } from "next"
import { LoginForm } from "./components/login-form"
import { getFirstNameByKid } from "@/lib/welcome"

export const metadata: Metadata = {
  title: "Sign in — Chris N Eddy's",
}

export default async function LoginPage() {
  const initialFirstName = await getFirstNameByKid()
  return (
    <div className="flex min-h-svh w-full items-center justify-center px-5 py-10">
      <LoginForm initialFirstName={initialFirstName} />
    </div>
  )
}
