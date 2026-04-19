"use client"

import { useState } from "react"
import { signIn, getSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { motion, AnimatePresence, useAnimation } from "framer-motion"
import { Loader2, Check, Eye, EyeOff, ArrowRight } from "lucide-react"
import logo from "../../../../public/logo.png"

type FormState = "idle" | "loading" | "success" | "error"

export function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [formState, setFormState] = useState<FormState>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const shakeControls = useAnimation()

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
          router.push("/dashboard")
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
    <motion.div animate={shakeControls} className="login-shell dock-in dock-in-1">
      <AnimatePresence>
        {(formState === "loading" || formState === "success") && (
          <motion.div
            className="login-progress"
            initial={{ width: "0%", opacity: 0 }}
            animate={{
              width: formState === "success" ? "100%" : "85%",
              opacity: 1,
            }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={
              formState === "success"
                ? { duration: 0.3, ease: "easeOut" }
                : { width: { duration: 20, ease: [0.1, 0.2, 0.3, 1] } }
            }
          />
        )}
      </AnimatePresence>

      <div className="dock-in dock-in-2 login-issue-line">
        Vol. 01 · Staff Entrance · 2026
      </div>

      <div className="dock-in dock-in-3 mt-5 flex justify-center">
        <Image
          src={logo}
          alt="ChrisNEddys"
          width={200}
          height={116}
          className="object-contain"
          priority
        />
      </div>

      <h1 className="dock-in dock-in-4 login-headline mt-5">
        Welcome <em>back</em>.
      </h1>

      <p className="dock-in dock-in-5 login-subtitle mt-3">
        Sign in to manage your restaurant locations.
      </p>

      <div className="dock-in dock-in-6 perforation mt-7">
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase">
          Credentials
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="login-error" role="alert">
                <span className="error-label">Access denied</span>
                {errorMessage}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          animate={{
            opacity: isDisabled ? 0.55 : 1,
          }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="font-label">
              Email
            </label>
            <div className="editorial-field">
              <input
                id="email"
                type="email"
                placeholder="manager@chrisneddys.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearError()
                }}
                autoComplete="email"
                required
                disabled={isDisabled}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="font-label">
              Password
            </label>
            <div className="editorial-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  clearError()
                }}
                autoComplete="current-password"
                required
                disabled={isDisabled}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={isDisabled}
                className="field-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-3.75 w-3.75" />
                ) : (
                  <Eye className="h-3.75 w-3.75" />
                )}
              </button>
            </div>
          </div>
        </motion.div>

        <button
          type="submit"
          className="login-submit mt-2"
          disabled={formState !== "idle"}
        >
          <AnimatePresence mode="wait" initial={false}>
            {formState === "loading" ? (
              <motion.span
                key="loading"
                className="flex items-center justify-center gap-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing in…
              </motion.span>
            ) : formState === "success" ? (
              <motion.span
                key="success"
                className="flex items-center justify-center gap-2"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              >
                <Check className="h-3.5 w-3.5" />
                Welcome back
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                className="flex items-center justify-center gap-2"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.15 }}
              >
                Sign in
                <ArrowRight className="h-3.25 w-3.25" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </form>

      <div className="dock-in dock-in-7 login-colophon">
        ChrisnEddys · Management Console
      </div>
    </motion.div>
  )
}
