import type { Metadata } from "next"
import { CounterPhoneLoginClient } from "./counter-phone-login-client"

export const metadata: Metadata = {
  title: "Sign in — Chris N Eddy's",
}

/** `P.login.phone()`. Public, so it takes no session and reads no data. */
export default function Page() {
  return <CounterPhoneLoginClient />
}
