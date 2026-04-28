"use client"

import * as React from "react"

const PHONE_BREAKPOINT = 640

export function useIsPhone() {
  const [isPhone, setIsPhone] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT - 1}px)`)
    const sync = () => setIsPhone(mql.matches)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])

  return isPhone
}
