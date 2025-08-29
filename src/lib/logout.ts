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
    }
    
    // Sign out with NextAuth
    await signOut({ 
      callbackUrl: "/login",
      redirect: true 
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