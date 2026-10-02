import { chromium } from "playwright";
import fs from "node:fs";

fs.mkdirSync("artifacts", { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: "fr-FR"
});
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", err => pageErrors.push(String(err)));

await page.route("https://world.openfoodfacts.org/**", async route => {
  const body = JSON.stringify({
    status: 1,
    product: {
      product_name: "Lentilles test",
      brands: "FoodActivity QA",
      quantity: "750 g",
      product_quantity: 750,
      nutriments: {
        "energy-kcal_100g": 92,
        "proteins_100g": 7.2,
        "carbohydrates_100g": 13.4,
        "fat_100g": 0.8,
        "fiber_100g": 5.1,
        "salt_100g": 0.42
      }
    }
  });
  await route.fulfill({ status: 200, contentType: "application/json", body });
});

await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert((await page.title()) === "FoodActivity", "Titre incorrect");
assert(await page.locator("#scanBtn").isVisible(), "Bouton scanner absent");
assert(await page.locator("#manualBtn").isVisible(), "Bouton ajout manuel absent");
assert(await page.locator(".bottom-nav").isVisible(), "Navigation basse absente");
assert((await page.locator("body").evaluate(el => el.scrollWidth)) <= 390, "Débordement horizontal sur l'accueil");

await page.screenshot({ path: "artifacts/01-home.png", fullPage: true });

await page.locator("#settingsBtn").click();
await page.locator("#settingCalories").fill("2200");
await page.locator("#settingProtein").fill("150");
await page.locator("#settingFiber").fill("30");
await page.locator("#settingMeals").fill("2");
await page.locator("#settingsForm button[type=submit]").click();
assert((await page.locator("#calorieProgress").textContent()).includes("2200"), "Objectif calories non mis à jour");

// Vérification récupération Open Food Facts via un appel réseau simulé.
await page.locator("#barcodeInput").fill("1234567890123");
await page.locator("#barcodeForm button[type=submit]").click();
await page.locator("#productDialog").waitFor({ state: "visible" });
assert((await page.locator("#editName").inputValue()) === "Lentilles test", "Nom OFF non récupéré");
assert((await page.locator("#editAvailable").inputValue()) === "750", "Poids produit OFF non récupéré");
assert((await page.locator("#editKcal").inputValue()) === "92", "Calories OFF non récupérées");
await page.locator('[data-dialog="productDialog"]').click();

async function addFood(food) {
  await page.locator("#manualBtn").click();
  await page.locator("#editName").fill(food.name);
  await page.locator("#editBrand").fill(food.brand || "");
  await page.locator("#editAvailable").fill(String(food.available));
  await page.locator("#editKcal").fill(String(food.kcal));
  await page.locator("#editProtein").fill(String(food.protein));
  await page.locator("#editCarbs").fill(String(food.carbs));
  await page.locator("#editFat").fill(String(food.fat));
  await page.locator("#editFiber").fill(String(food.fiber));
  await page.locator("#editSalt").fill(String(food.salt));
  await page.locator("#productForm button[type=submit]").click();
}

await addFood({ name:"Lentilles", available:530, kcal:92, protein:7.2, carbs:13.4, fat:0.8, fiber:5.1, salt:0.42 });
await addFood({ name:"Pois chiches", available:400, kcal:137, protein:7.3, carbs:19.8, fat:2.4, fiber:6.4, salt:0.35 });
await addFood({ name:"Œuf dur", available:100, kcal:155, protein:12.6, carbs:1.1, fat:10.6, fiber:0, salt:0.31 });

assert((await page.locator(".food-item").count()) === 3, "Les trois aliments ne sont pas affichés");
assert(!(await page.locator("#composeBtn").isDisabled()), "Composer mon repas reste désactivé");

await page.screenshot({ path: "artifacts/02-products.png", fullPage: true });

await page.locator("#composeBtn").click();
await page.locator("#recommendationSection").waitFor({ state: "visible" });
assert((await page.locator(".rec-row").count()) >= 1, "Aucune portion recommandée");
const kcalText = await page.locator("#recKcal").textContent();
assert(/\d+ kcal/.test(kcalText), "Total calorique recommandé absent");

await page.screenshot({ path: "artifacts/03-recommendation.png", fullPage: true });

await page.locator("#validateMealBtn").click();
await page.waitForTimeout(150);
assert((await page.locator(".history-item").count()) === 1, "Le repas n'est pas enregistré dans l'historique");
const beforeReload = await page.locator("#calorieProgress").textContent();

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(250);
assert((await page.locator(".history-item").count()) === 1, "Historique non persistant après rechargement");
assert((await page.locator("#calorieProgress").textContent()) === beforeReload, "Résumé journalier non persistant");

await page.screenshot({ path: "artifacts/04-history.png", fullPage: true });

assert(pageErrors.length === 0, "Erreurs JavaScript: " + pageErrors.join(" | "));

fs.writeFileSync("artifacts/report.json", JSON.stringify({
  status: "success",
  tests: {
    home: true,
    responsiveNoHorizontalOverflow: true,
    settings: true,
    openFoodFactsLookup: true,
    manualFoodEntry: true,
    mealComposition: true,
    mealValidation: true,
    localPersistence: true,
    javascriptErrors: 0
  },
  viewport: "390x844"
}, null, 2));

await browser.close();
console.log("FoodActivity verification: SUCCESS");
