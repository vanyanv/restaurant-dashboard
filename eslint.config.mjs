// ESLint here does one job: React's own rules for hooks and React Compiler
// (eslint-plugin-react-hooks). The compiler silently skips any component
// that breaks those rules, or that carries a comment switching them off, and
// before this file existed nothing in the repo could see either. Style and
// formatting are not linted.
//
// The parser is Babel's, not typescript-eslint's: typescript-eslint does not
// support TypeScript 7 yet, and these rules need syntax, not types.
import babelParser from "@babel/eslint-parser"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  {
    ignores: ["src/generated/**", ".next/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
        },
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "react-hooks": reactHooks },
    // Every rule warns, and `npm run lint:hooks` fails when the number of
    // warnings goes UP (`--max-warnings` in package.json). The findings that
    // were already here when this file landed are the baseline; lower the
    // number as they are fixed, never raise it. rules-of-hooks is an error
    // outright: breaking it is a crash, not a missed optimisation.
    rules: {
      ...Object.fromEntries(Object.keys(reactHooks.configs.recommended.rules).map((r) => [r, "warn"])),
      "react-hooks/rules-of-hooks": "error",
    },
  },
]
