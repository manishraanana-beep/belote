import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    // Plusieurs joueurs dans des fenêtres simultanées : aucune ne doit être mise en veille.
    launchOptions: {
      args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
      ...(process.env.BELOTE_CHROMIUM_PATH ? { executablePath: process.env.BELOTE_CHROMIUM_PATH } : {}),
    },
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
      // Roue du jour désactivée par défaut (montant 0) ; le test de la roue la règle lui-même.
      BELOTE_LOGIN_BONUS: "0",
      BELOTE_ADMIN_KEY: "cle-e2e",
    },
    reuseExistingServer: false,
  },
  reporter: "list",
});
