import { test, expect } from "@playwright/test";
test("ordinateur : profil, table VIP, règles, robots et partie complète", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Les tables du salon" }),
  ).toBeVisible();
  await page.locator('[data-action="profile"]').click();
  await page.locator('#profile-form [name="name"]').fill("Alice");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".profile-button")).toContainText("Alice");
  await page.locator('.hero-actions [data-action="create"]').click();
  await page.locator('#create-form [name="name"]').fill("Le salon d’Alice");
  await page.locator('#create-form [name="target"]').fill("100");
  await page
    .getByRole("button", { name: "Créer la table", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Le salon d’Alice" }),
  ).toBeVisible();
  await page.locator('[data-action="bot"][data-seat="1"]').click();
  await page.locator('[data-action="bot"][data-seat="2"]').click();
  await page.locator('[data-action="bot"][data-seat="3"]').click();
  await page.getByRole("button", { name: "Commencer la partie" }).click();
  await expect(page.locator(".hand .card")).toHaveCount(8);
  await page.locator("#bid-form button").click();
  await expect(page.locator(".hand .playable").first()).toBeVisible({
    timeout: 10000,
  });
  await page.screenshot({
    path: "test-results/desktop-table.png",
    fullPage: true,
  });
  for (let i = 0; i < 8; i++) {
    await page.locator(".hand .playable").first().click();
    if (i < 7)
      await expect(page.locator(".hand .playable").first()).toBeVisible({
        timeout: 15000,
      });
  }
  await expect(page.locator(".summary")).toContainText("PARTIE TERMINÉE", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Mes statistiques" }).click();
  await expect(page.locator(".stats strong").first()).toContainText("1");
  await page.locator('[data-action="close"]').click();
  await page.getByRole("button", { name: "Revanche →" }).click();
  await expect(page.locator(".hand .card")).toHaveCount(8);
  expect(errors).toEqual([]);
});
test("mobile : lobby sans débordement, invitation privée et reconnexion navigateur", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Les tables du salon" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-lobby.png",
    fullPage: true,
  });
  await page.locator('.hero-actions [data-action="create"]').click();
  await page.locator('#create-form [name="name"]').fill("Salon mobile");
  await page
    .getByRole("button", { name: "Créer la table", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Salon mobile" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Salon mobile" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const link = await page.locator(".side-panel code").textContent();
  const text = await page.locator(".side-panel details small").textContent();
  const tableId = text.replace("Table : ", "");
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const guest = await guestContext.newPage();
  await guest.goto(
    "/#" + encodeURIComponent(JSON.stringify({ tableId, invite: link })),
  );
  await expect(guest.locator("#invite-form")).toBeVisible();
  await guest
    .getByRole("button", { name: "Demander une place", exact: true })
    .click();
  await expect(guest.locator("#modal")).toContainText("Objectif 1000");
  await guest
    .getByRole("button", { name: "Accepter les règles et demander une place" })
    .click();
  await expect(page.locator(".request")).toBeVisible();
  await page.locator('[data-action="admit"]').click();
  await expect(
    guest.getByRole("heading", { name: "Salon mobile" }),
  ).toBeVisible();
  await page.locator('[data-action="bot"][data-seat="2"]').click();
  await page.locator('[data-action="bot"][data-seat="3"]').click();
  await page.getByRole("button", { name: "Commencer la partie" }).click();
  await expect(page.locator(".hand .card")).toHaveCount(8);
  await page.screenshot({
    path: "test-results/mobile-table.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await guestContext.close();
  await context.close();
});
