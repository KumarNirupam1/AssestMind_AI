import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent tooling and vendored skills: not application source, and large
    // enough that walking them dominates lint time on a mounted filesystem.
    "node_modules/**",
    ".agents/**",
    ".claude/**",
    ".windsurf/**",
    // Data, docs and generated SQL are not linted as code.
    "data/**",
    "docs/**",
    "prisma/migrations/**",
  ]),

  // shadcn-generated files are vendored verbatim so that `shadcn add` can
  // upgrade them without conflicts. Two of them (`use-mobile`, `carousel`)
  // synchronise external state with useEffect + setState, which this rule
  // flags. Rewriting them here would be silently undone on the next
  // `shadcn add`, so the rule is scoped off for the vendored paths instead
  // of edited around. Application code under app/ and features/ is still
  // held to the rule.
  {
    files: ["components/ui/**", "hooks/**"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
