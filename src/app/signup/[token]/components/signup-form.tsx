"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence, useAnimation } from "framer-motion"
import { Loader2, Check, Eye, EyeOff, ArrowRight } from "lucide-react"

type FormState = "idle" | "loading" | "success" | "error"

const MIN_PASSWORD_LENGTH = 6

export function SignupForm({ token }: { token: string }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formState, setFormState] = useState<FormState>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const router = useRouter()
  const shakeControls = useAnimation()

  const isDisabled = formState === "loading" || formState === "success"
  const passwordMet = password.length >= MIN_PASSWORD_LENGTH
  const passwordRuleState: "rest" | "met" | "unmet" =
    password.length === 0 ? "rest" : passwordMet ? "met" : "unmet"

  const clearError = () => {
    if (formState === "error") {
      setFormState("idle")
      setErrorMessage("")
    }
  }

  function shake() {
    shakeControls.start({
      x: [0, -8, 8, -6, 6, -3, 3, 0],
      transition: { duration: 0.4, ease: "easeOut" },
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrorMessage("")

    if (!passwordMet) {
      setFormState("error")
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      shake()
      return
    }

    setFormState("loading")

    try {
      const res = await fetch("/api/auth/signup-with-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, password }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const message =
          typeof body?.error === "string"
            ? body.error
            : "Something went wrong. Please try again."
        setFormState("error")
        setErrorMessage(message)
        shake()
        return
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setFormState("error")
        setErrorMessage("Account created but sign-in failed. Try logging in.")
        return
      }

      setFormState("success")
      setTimeout(() => router.push("/dashboard"), 800)
    } catch {
      setFormState("error")
      setErrorMessage("Network error. Please try again.")
      shake()
    }
  }

  return (
    <motion.form
      animate={shakeControls}
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-4"
    >
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
              <span className="error-label">Could not sign up</span>
              {errorMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        animate={{ opacity: isDisabled ? 0.55 : 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="signup-name" className="font-label">
            Name
          </label>
          <div className="editorial-field">
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                clearError()
              }}
              autoComplete="name"
              required
              disabled={isDisabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="signup-email" className="font-label">
            Email
          </label>
          <div className="editorial-field">
            <input
              id="signup-email"
              type="email"
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
          <label htmlFor="signup-password" className="font-label">
            Password
          </label>
          <div className="editorial-field">
            <input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearError()
              }}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={isDisabled}
              aria-describedby="signup-password-rule"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((p) => !p)}
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
          <div
            id="signup-password-rule"
            className="password-rule"
            data-state={passwordRuleState}
          >
            <span className="password-rule__mark" aria-hidden="true">
              {passwordRuleState === "met" ? "✓" : "—"}
            </span>
            <span>At least {MIN_PASSWORD_LENGTH} characters</span>
          </div>
        </div>
      </motion.div>

      <button
        type="submit"
        className="login-submit mt-2"
        disabled={isDisabled}
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
              Issuing pass…
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
              Welcome
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
              Sign and enter
              <ArrowRight className="h-3.25 w-3.25" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.form>
  )
}
