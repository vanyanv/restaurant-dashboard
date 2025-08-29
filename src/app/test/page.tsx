import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function TestPage() {
  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Styling Test</h1>
      
      <div className="space-y-4">
        <Button>Primary Button</Button>
        <Button variant="secondary">Secondary Button</Button>
        <Button variant="outline">Outline Button</Button>
      </div>

      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>Test Card</CardTitle>
          <CardDescription>This is a test card to verify styling</CardDescription>
        </CardHeader>
        <CardContent>
          <p>If you can see proper styling here, the CSS is working.</p>
        </CardContent>
      </Card>

      <div className="bg-primary text-primary-foreground p-4 rounded">
        Primary Background Test - Should be orange/red
      </div>

      <div className="bg-card text-card-foreground border p-4 rounded">
        Card Background Test - Should be white with border
      </div>

      <div className="bg-muted text-muted-foreground p-4 rounded">
        Muted Background Test
      </div>

      <p className="text-sm text-muted-foreground">
        If these elements have proper colors and spacing, Tailwind + shadcn is working correctly.
      </p>
    </div>
  )
}