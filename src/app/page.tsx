import Link from "next/link"
import { ChefHat } from "lucide-react"

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-primary/20 rounded-2xl flex items-center justify-center">
            <ChefHat className="h-10 w-10 text-primary" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">ChrisNEddys Dashboard</h1>
          <p className="text-muted-foreground text-lg">Manage your restaurant chain with ease</p>
        </div>
        <div className="flex justify-center">
          <Link 
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Access Dashboard
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Owner dashboard for store management and analytics
        </p>
      </div>
    </div>
  )
}