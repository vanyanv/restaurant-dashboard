"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { User, Mail, Lock, Loader2 } from "lucide-react"
import { createManager } from "@/app/actions/manager-actions"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

const managerFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

type ManagerFormValues = z.infer<typeof managerFormSchema>

export function CreateManagerForm() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<ManagerFormValues>({
    resolver: zodResolver(managerFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  })

  const onSubmit = async (values: ManagerFormValues) => {
    setIsLoading(true)
    
    try {
      const formData = new FormData()
      formData.append("name", values.name)
      formData.append("email", values.email)
      formData.append("password", values.password)

      const result = await createManager(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success("Manager created successfully!", {
        description: `${result.manager?.name} has been added as a manager.`,
      })
      
      // Redirect to managers list
      router.push("/dashboard/managers")
      router.refresh()
      
    } catch (error) {
      console.error("Error creating manager:", error)
      toast.error("Failed to create manager", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Full Name *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="John Smith"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                The manager's full name as it will appear in the system
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Address *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="john.smith@chrisneddys.com"
                  type="email"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                This will be used to log in to the dashboard
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                Password *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Minimum 6 characters"
                  type="password"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                Temporary password - the manager should change this after first login
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/dashboard/managers")}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Manager"
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}