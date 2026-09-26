import { defineConfig } from "vitest/config";

// Security-rules tests run in Node against the Firebase emulators:
//   npm run test:rules
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
