/** "Chris N Eddys - Van Nuys" -> "Van Nuys": the logo or the page already says the rest. */
export function shortStoreName(name: string): string {
  return name.replace(/^chris\s*n\s*edd(y|ie)'?s\s*[-–·:]\s*/i, "").trim() || name
}
