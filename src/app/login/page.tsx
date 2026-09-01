import type { Metadata } from "next"
import { CounterLoginClient } from "./counter-login-client"

export const metadata: Metadata = {
  title: "Sign in — Chris N Eddy's",
}

/** Sign in — `P.login`. Public, so it takes no session and reads no data. */
export default function LoginPage() {
  return <CounterLoginClient />
}
