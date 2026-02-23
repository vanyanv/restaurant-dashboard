"use client"

import { useState, useEffect } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { motion, AnimatePresence, useAnimation } from "framer-motion"
import { Loader2, Check, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import logo from "../../../../public/logo.png"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type FormState = "idle" | "loading" | "success" | "error"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [formState, setFormState] = useState<FormState>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const shakeControls = useAnimation()

  useEffect(() => {
    shakeControls.start({
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] },
    })
  }, [shakeControls])

  const isDisabled = formState === "loading" || formState === "success"

  const clearError = () => {
    if (formState === "error") {
      setFormState("idle")
      setErrorMessage("")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormState("loading")
    setErrorMessage("")

    try {
      const minLoadingTime = new Promise((resolve) =>
        setTimeout(resolve, 600)
      )

      const [result] = await Promise.all([
        signIn("credentials", {
          email,
          password,
          redirect: false,
        }),
        minLoadingTime,
      ])

      if (result?.error) {
        setFormState("error")
        setErrorMessage("Invalid email or password")
        shakeControls.start({
          x: [0, -8, 8, -6, 6, -3, 3, 0],
          transition: { duration: 0.4, ease: "easeOut" },
        })
        return
      }

      const session = await getSession()

      if (session) {
        setFormState("success")
        setTimeout(() => {
          if (session.user.role === "MANAGER") {
            router.push("/manager/report")
          } else {
            router.push("/dashboard")
          }
        }, 1200)
      } else {
        setFormState("error")
        setErrorMessage("An error occurred. Please try again.")
      }
    } catch {
      setFormState("error")
      setErrorMessage("An error occurred. Please try again.")
      shakeControls.start({
        x: [0, -8, 8, -6, 6, -3, 3, 0],
        transition: { duration: 0.4, ease: "easeOut" },
      })
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={shakeControls}
      >
        <Card className="relative overflow-hidden">
          <AnimatePresence>
            {(formState === "loading" || formState === "success") && (
              <motion.div
                className="absolute top-0 left-0 right-0 h-0.75 bg-primary/10 z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <motion.div
                  className="h-full bg-primary rounded-r-full"
                  initial={{ width: "0%" }}
                  animate={{
                    width: formState === "success" ? "100%" : "85%",
                  }}
                  transition={
                    formState === "success"
                      ? { duration: 0.3, ease: "easeOut" }
                      : { duration: 20, ease: [0.1, 0.2, 0.3, 1] }
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>

          <CardHeader className="text-center">
            <Image
              src={logo}
              alt="ChrisNEddys Restaurant Dashboard"
              width={240}
              height={140}
              className="object-contain mx-auto mb-6"
              priority
            />
            <CardDescription className="text-base">
              Sign in to manage your restaurant locations
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="flex flex-col gap-6">
                <motion.div
                  animate={{
                    opacity: isDisabled ? 0.5 : 1,
                    filter: isDisabled ? "blur(1px)" : "blur(0px)",
                  }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex flex-col gap-6"
                >
                  <AnimatePresence>
                    {errorMessage && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="bg-destructive/15 text-destructive text-sm rounded-lg p-3">
                          {errorMessage}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.35, ease: "easeOut" }}
                    className="grid gap-3"
                  >
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="manager@chrisneddys.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        clearError()
                      }}
                      required
                      disabled={isDisabled}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.35, ease: "easeOut" }}
                    className="grid gap-3"
                  >
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value)
                          clearError()
                        }}
                        required
                        disabled={isDisabled}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword((prev) => !prev)}
                        disabled={isDisabled}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.35, ease: "easeOut" }}
                >
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={formState !== "idle"}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {formState === "loading" ? (
                        <motion.span
                          key="loading"
                          className="flex items-center justify-center gap-2"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Signing in...
                        </motion.span>
                      ) : formState === "success" ? (
                        <motion.span
                          key="success"
                          className="flex items-center justify-center gap-2"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 25,
                          }}
                        >
                          <Check className="h-4 w-4" />
                          Welcome back!
                        </motion.span>
                      ) : (
                        <motion.span
                          key="idle"
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.15 }}
                        >
                          Sign In
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Button>
                </motion.div>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
