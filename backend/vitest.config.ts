import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://pm:pm@localhost:5432/pm_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
      LOCAL_UPLOAD_DIR: "./.test-uploads",
      API_URL: "http://localhost:4000",
    },
  },
});
