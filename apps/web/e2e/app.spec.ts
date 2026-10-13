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
  await expect(page.getByText("Price is stale")).toBeVisible();
  await page.goto("/help");
  await expect(page.getByText("Price is stale")).toBeVisible();
});

test("market detail explains the limits", async ({ page }) => {
  await mockService(page);
  await page.goto("/markets/QQQ");
  await expect(page.getByText("77% LTV")).toBeVisible();
  await expect(page.getByText("Soft limit, market closed")).toBeVisible();
  await expect(page.getByText("Market depth")).toBeVisible();
});

test("trade asks to sign in before anything else", async ({ page }) => {
  await mockService(page);
  await page.goto("/trade?symbol=QQQ");
  await expect(page.getByRole("heading", { name: "Trade", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign-in unavailable" })).toBeDisabled();
  await expect(page.getByText("Position $200 of the $500 cap")).toBeVisible();
});

test("a blocked region cannot reach the trade form", async ({ page }) => {
  await mockService(page, { eligible: false });
  await page.goto("/trade");
  await expect(page.getByText("Levra is not available where you are")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Positions" })).toBeVisible();
});

test("help lists the deployed contracts and explains each word", async ({ page }) => {
  await mockService(page);
  await page.goto("/help#ltv");
  await expect(page.getByText("0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6").first()).toBeVisible();
  await expect(page.getByText("Loan to value")).toBeVisible();
});

test("an unknown page says so", async ({ page }) => {
  await mockService(page);
  await page.goto("/nowhere");
  await expect(page.getByText("This page does not exist")).toBeVisible();
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
