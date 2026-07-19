import { defineConfig } from "vitest/config";

// Unit tests target pure functions (server/pure.ts, src/adapters.ts) — no DOM,
// no server import — so the fast node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
