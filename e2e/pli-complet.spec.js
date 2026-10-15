import { test, expect } from "@playwright/test";
test("pli complet visible avant ramassage", async ({ browser }) => {
  test.setTimeout(170000);
  const page = await (await browser.newContext({ viewport: { width: 414, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.locator(".features [data-action='practice']").click();
  await page.locator('[data-action="confirmPractice"]').click();
  let four = false;
  for (let i = 0; i < 600 && !four; i++) {
    if ((await page.locator(".trick:not(.collecting) .tcard").count()) === 4) { four = true; break; }
    if (await page.locator(".hand.my-turn").count()) for (let k = 0; k < 8; k++) { await page.locator(".hand .hcard").nth(k).dispatchEvent("pointerdown").catch(() => {}); await page.locator(".hand .hcard").nth(k).dispatchEvent("pointerup").catch(() => {}); if (!(await page.locator(".hand.my-turn").count())) break; }
    const pass = page.locator('[data-action="pass"]').first();
    if (await pass.isVisible().catch(() => false)) await pass.click().catch(() => {});
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: "test-results/screens/pli-complet.png" });
  expect(four).toBe(true);
});

test("dernier pli : les 4 cartes restent visibles avant le résultat de la donne", async ({ browser }) => {
  test.setTimeout(170000);
  const page = await (await browser.newContext({ viewport: { width: 414, height: 800 }, isMobile: true, hasTouch: true })).newPage();
  await page.addInitScript(() => sessionStorage.setItem("discover", "1"));
  await page.goto("/");
  await page.locator(".features [data-action='practice']").click();
  await page.locator('[data-action="confirmPractice"]').click();
  await page.evaluate(() => {
    window.__log = [];
    new MutationObserver(() => {
      const h = document.querySelectorAll(".hand .hcard").length, t = document.querySelectorAll(".trick .tcard").length, c = !!document.querySelector(".trick.collecting"), o = !!document.querySelector(".overlay-page");
      const k = `${h}/${t}/${c ? "C" : ""}/${o ? "O" : ""}`;
      if (window.__log.at(-1) !== k) window.__log.push(k);
    }).observe(document.getElementById("app"), { childList: true, subtree: true });
  });
  let seen = false;
  for (let i = 0; i < 1500 && !seen; i++) {
    const log = await page.evaluate(() => window.__log);
    const o = log.findIndex((k) => k.endsWith("/O"));
    if (o >= 0) {
      seen = log.slice(0, o).some((k) => k === "0/4//");
      break;
    }
    if (await page.locator(".hand.my-turn").count())
      for (let k = 0; k < 8; k++) {
        const c = page.locator(".hand .hcard").nth(k);
        await c.dispatchEvent("pointerdown").catch(() => {});
        await c.dispatchEvent("pointerup").catch(() => {});
        if (!(await page.locator(".hand.my-turn").count())) break;
      }
    const pass = page.locator('[data-action="pass"]').first();
    if (await pass.isVisible().catch(() => false)) await pass.click().catch(() => {});
    await page.waitForTimeout(80);
  }
  expect(seen).toBe(true);
});
