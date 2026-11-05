/**
 * Accepting an invite wears the login page's Counter parts, which the root
 * layout already loads, so this layout adds nothing. It used to load the
 * pre-Counter serif and stylesheet for a page that no longer uses them.
 */
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
