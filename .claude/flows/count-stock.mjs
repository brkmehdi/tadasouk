// The merchant counts the stock from shelf photos: PRIME bottles in 4 colours (one product with
// colours), then a second shelf of soft drinks, a fix by hand, and the stock update.
// Needs the local test merchant made by the seed script (sign-in in .claude/toolkit.local.json)
// and the two shelf photos (paths in toolkit.local.json "count_photos"). Calls the AI twice.

export const title = "Count the stock from shelf photos";
export const devices = ["mobile", "desktop"];
export const notes = [
  "Local copy with a test merchant: 9 products, PRIME with 4 colour photos, 4 rice bags that are on neither shelf.",
  "Shelf photos from Wikimedia Commons (free licences), used for this local test only.",
  "Each run calls the AI twice (about 3 cents).",
];

export default async function ({ page, cfg, go, test, check, setup, step, wait }) {
  const login = cfg.test_login;
  const photos = cfg.count_photos;
  setup("Sign in as the test merchant");
  await go("/connexion");
  await page.getByRole("button", { name: "J'ai déjà un compte" }).click();
  await page.fill("#id", login.email);
  await page.fill("#password", login.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/app", { timeout: 60000 });
  await page.getByRole("button", { name: "Produits", exact: true }).click();
  await wait(800);

  test("It should open the stock count from Products");
  await page.getByRole("button", { name: /Compter le stock/ }).click();
  await check(() => page.getByText("Prenez une étagère en photo").isVisible(), "Count screen open with its explanation");
  await check(async () => (await page.locator("img[src^='/media/']").count()) >= 12, "The 12 product photos the AI will look for are shown");
  await step("count-start");

  test("It should count the PRIME shelf, colour by colour");
  await page.getByTestId("count-gallery").setInputFiles(photos.prime);
  await check(
    () => page.getByRole("status").filter({ hasText: "compte vos produits" }).first().waitFor({ timeout: 5000 }).then(() => true),
    "Photo sent, the AI is counting",
  );
  await step("counting");
  const rows = page.getByTestId("count-rows").locator("li");
  await rows.first().waitFor({ timeout: 90000 });
  const prime = rows.filter({ hasText: "PRIME" });
  await check(async () => Number(await prime.getByTestId("count-n").textContent()) >= 10, "PRIME counted: at least 10 bottles");
  await check(async () => {
    const text = await prime.textContent();
    return text.includes("Lemon Lime") && text.includes("Blue Raspberry");
  }, "Colours counted apart (Lemon Lime, Blue Raspberry...)");
  await check(async () => (await rows.filter({ hasText: "Riz" }).count()) === 0, "No rice bag counted on a drinks shelf");
  await step("prime-counted");

  test("It should remove a wrong dot with a tap");
  const before = Number(await prime.getByTestId("count-n").textContent());
  await page.locator("[data-dot=on]").first().click();
  await check(async () => Number(await prime.getByTestId("count-n").textContent()) === before - 1, "Dot removed, the count goes down by one");
  await step("dot-removed");
  await page.locator("[data-dot=off]").first().click();
  await check(async () => Number(await prime.getByTestId("count-n").textContent()) === before, "Tapped again, the dot is back");

  test("It should add a second shelf and add it up");
  await page.getByTestId("count-gallery").setInputFiles(photos.soft);
  await page.getByText("L'IA compte vos produits").waitFor({ timeout: 10000 }).catch(() => {});
  await rows.filter({ hasText: "Sunkist" }).first().waitFor({ timeout: 90000 });
  await check(async () => (await rows.count()) >= 5, "PRIME plus 4 soft drinks in the list");
  await page.getByTestId("count-rows").scrollIntoViewIfNeeded();
  await step("two-shelves");

  test("It should fix a count by hand");
  const sevenUp = rows.filter({ hasText: "7Up" });
  const n7 = Number(await sevenUp.getByTestId("count-n").textContent());
  await sevenUp.getByRole("button", { name: "+" }).click();
  await check(async () => Number(await sevenUp.getByTestId("count-n").textContent()) === n7 + 1, "7Up raised by one with the plus button");
  const expected = Number(await prime.getByTestId("count-n").textContent());

  test("It should update the stock");
  await page.getByRole("button", { name: "Mettre à jour le stock" }).click();
  await check(() => page.getByText("Stock mis à jour").waitFor({ timeout: 15000 }).then(() => true), "Stock saved");
  await step("saved");
  await page.getByRole("button", { name: "Terminer" }).click();
  await wait(1500);
  await check(
    async () => (await page.getByRole("button", { name: /PRIME Hydration/ }).first().textContent()).includes(`Stock ${expected}`),
    `Products list shows PRIME with stock ${expected}`,
  );
  await step("products-after");
}
