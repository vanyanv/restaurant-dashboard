import { signOut } from "next-auth/react"

export async function performLogout(): Promise<void> {
  try {
    // Clear browser storage
    if (typeof window !== 'undefined') {
      localStorage.clear()
      sessionStorage.clear()
      
      // Clear any cookies that might be cached
      document.cookie.split(";").forEach(cookie => {
        const eqPos = cookie.indexOf("=")
        const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
      })
      
      // Immediate redirect using window.location for instant response
      window.location.href = "/login"
    }
    
    // Sign out with NextAuth (but don't wait for redirect)
    signOut({ 
      callbackUrl: "/login",
      redirect: false  // We handle redirect ourselves above
    })
    
  } catch (error) {
    console.error("Logout error:", error)
    
    // Fallback: force redirect to login if signOut fails
    if (typeof window !== 'undefined') {
      window.location.href = "/login"
    }
    
    throw error
  }
}