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
      BELOTE_PACKS: "[{\"id\": \"pack-1000\", \"credits\": 1000, \"price\": \"0,99 €\", \"priceCents\": 99}, {\"id\": \"pack-3000\", \"credits\": 3000, \"price\": \"2,49 €\", \"priceCents\": 249, \"bonus\": \"+20 %\"}, {\"id\": \"pack-8000\", \"credits\": 8000, \"price\": \"4,99 €\", \"priceCents\": 499, \"bonus\": \"+60 %\"}, {\"id\": \"pack-20000\", \"credits\": 20000, \"price\": \"9,99 €\", \"priceCents\": 999, \"bonus\": \"Meilleure offre\"}]",
      BELOTE_SIGNUP_BONUS: "600",
      BELOTE_TABLE_FEE_PCT: "0",
      // Roue du jour désactivée par défaut (montant 0) ; le test de la roue la règle lui-même.
      BELOTE_LOGIN_BONUS: "0",
      // Pas d'appel des joueurs en ligne dans les tests (plusieurs navigateurs ouverts en même temps).
      BELOTE_MATCH_WAIT_SECONDS: "0",
      BELOTE_ADMIN_KEY: "cle-e2e",
    },
    reuseExistingServer: false,
  },
  reporter: "list",
});
