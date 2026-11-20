import { expect, mockService, test } from "./fixtures";

test("markets shows prices, limits and leverage from the service", async ({ page }) => {
  await mockService(page);
  await page.goto("/markets");
  await expect(page.getByRole("heading", { name: "Markets", exact: true })).toBeVisible();
  await expect(page.getByText("$741.45").first()).toBeVisible();
  await expect(page.getByText("73% · 77%")).toBeVisible();
  await expect(page.getByText("3.70× long")).toBeVisible();
  await expect(page.getByText("No short")).toBeVisible();
});

test("a stale price shows the banner on every page", async ({ page }) => {
  await mockService(page, { stale: true });
  await page.goto("/markets");
  await expect(page.getByText("Price delayed")).toBeVisible();
  await page.goto("/help");
  await expect(page.getByText("Price delayed")).toBeVisible();
});

test("market detail explains the limits", async ({ page }) => {
  await mockService(page);
  await page.goto("/markets/QQQ");
  await expect(page.getByText("77%", { exact: true })).toBeVisible();
  await expect(page.getByText("Weekend limit")).toBeVisible();
  await expect(page.getByText("Price impact by size")).toBeVisible();
});

test("trade asks to sign in before anything else", async ({ page }) => {
  await mockService(page);
  await page.goto("/trade?symbol=QQQ");
  await expect(page.getByRole("heading", { name: "Trade", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign-in unavailable" })).toBeDisabled();
  await expect(page.getByText("$200 of $500 size limit")).toBeVisible();
});

test("a blocked region cannot reach the trade form", async ({ page }) => {
  await mockService(page, { eligible: false });
  await page.goto("/trade");
  await expect(page.getByText("Not available in your region")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Positions" })).toBeVisible();
});

test("the trade form opens when the service has the region and terms gate off", async ({ page }) => {
  await mockService(page, { gateOff: true });
  await page.goto("/trade?symbol=QQQ");
  await expect(page.getByRole("heading", { name: "Trade", exact: true })).toBeVisible();
  await expect(page.getByText("could not check your region")).toHaveCount(0);
});

test("help lists the deployed contracts and explains each word", async ({ page }) => {
  await mockService(page);
  await page.goto("/help#ltv");
  await expect(page.getByText("0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6").first()).toBeVisible();
  await expect(page.getByText("Your debt divided by")).toBeVisible();
});

test("an unknown page says so", async ({ page }) => {
  await mockService(page);
  await page.goto("/nowhere");
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("markets shows the market clock with the session and a countdown", async ({ page }) => {
  await mockService(page);
  await page.goto("/monad/markets");
  await expect(page.getByText(/^(Closes|Opens) in /).first()).toBeVisible();
});

test("animations are off when the system asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockService(page);
  await page.goto("/monad/markets");
  const duration = await page.locator(".animate-page-in").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test("old links move to the Monad pages and the network picker lists the chains", async ({ page }) => {
  await mockService(page);
  await page.goto("/markets");
  await expect(page).toHaveURL(/\/monad\/markets$/);
  await page.getByRole("button", { name: /Change network/ }).click();
  const sheet = page.getByRole("dialog", { name: "Network" });
  await expect(sheet.getByRole("button", { name: /Monad/ })).toHaveAttribute("aria-current", "true");
});

test("an unknown network in the URL says the page does not exist", async ({ page }) => {
  await mockService(page);
  await page.goto("/nowhere/markets");
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("the light theme is kept after a reload", async ({ page }) => {
  await mockService(page);
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Light" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 245, 242)");
});

test("phones get the tab bar instead of the top navigation", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  await mockService(page);
  await page.goto("/markets");
  const tabBar = page.getByRole("navigation", { name: "Main" }).last();
  await expect(tabBar).toBeVisible();
  await expect(tabBar.getByRole("link", { name: /Positions/ })).toBeVisible();
});

// The page must never be wider than the screen. Compared with the device width, not innerWidth, which grows with the page.
for (const path of ["/markets", "/markets/QQQ", "/trade", "/positions", "/earn", "/deposit", "/settings", "/help"]) {
  test(`${path} fits a phone screen`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "phone layout only");
    await mockService(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
}
