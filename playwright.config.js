import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    launchOptions: process.env.BELOTE_CHROMIUM_PATH
      ? { executablePath: process.env.BELOTE_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "node src/server.js",
    url: "http://127.0.0.1:3100/api/health",
    env: {
      PORT: "3100",
      BELOTE_DATA_DIR: "/tmp/belote-e2e-" + Date.now(),
      BELOTE_FILL_SECONDS: "4",
      BELOTE_TEST_SHOP: "on",
      BELOTE_SIGNUP_BONUS: "600",
      BELOTE_ADMIN_KEY: "cle-e2e",
    },
    reuseExistingServer: false,
  },
  reporter: "list",
});
