const STORAGE_KEY = "foodactivity-v0";
const DEFAULT_STATE = {
  settings: { calories: 2000, protein: 120, fiber: 30, meals: 2 },
  selected: [],
  history: []
};

let state = loadState();
let scanner = null;
let scannerRunning = false;
let currentRecommendation = [];

const $ = (id) => document.getElementById(id);
const round = (n, digits = 1) => Number((Number(n || 0)).toFixed(digits));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      settings: { ...DEFAULT_STATE.settings, ...(parsed?.settings || {}) },
      selected: Array.isArray(parsed?.selected) ? parsed.selected : [],
      history: Array.isArray(parsed?.history) ? parsed.history : []
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayKey(date = new Date()) {
  return date.toLocaleDateString("fr-CA");
}

function todayMeals() {
  const key = todayKey();
  return state.history.filter((meal) => meal.date === key);
}

function totalNutrition(items) {
  return items.reduce(
    (acc, item) => {
      const grams = Number(item.grams || 0);
      const factor = grams / 100;
      const p = item.per100 || {};
      acc.kcal += Number(p.kcal || 0) * factor;
      acc.protein += Number(p.protein || 0) * factor;
      acc.carbs += Number(p.carbs || 0) * factor;
      acc.fat += Number(p.fat || 0) * factor;
      acc.fiber += Number(p.fiber || 0) * factor;
      acc.salt += Number(p.salt || 0) * factor;
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 }
  );
}

function consumedToday() {
  return todayMeals().reduce(
    (acc, meal) => {
      for (const key of Object.keys(acc)) acc[key] += Number(meal.totals?.[key] || 0);
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 }
  );
}

function remainingTargets() {
  const used = consumedToday();
  return {
    kcal: Math.max(0, state.settings.calories - used.kcal),
    protein: Math.max(0, state.settings.protein - used.protein),
    fiber: Math.max(0, state.settings.fiber - used.fiber)
  };
}

function renderSummary() {
  const used = consumedToday();
  const meals = todayMeals();
  const remaining = Math.max(0, state.settings.calories - used.kcal);
  const pct = clamp((used.kcal / state.settings.calories) * 100, 0, 100);

  $("calorieProgress").textContent = `${Math.round(used.kcal)} / ${state.settings.calories} kcal`;
  $("proteinProgress").textContent = `${round(used.protein)} / ${state.settings.protein} g`;
  $("fiberProgress").textContent = `${round(used.fiber)} / ${state.settings.fiber} g`;
  $("remainingCalories").textContent = `${Math.round(remaining)} kcal`;
  $("mealCounter").textContent = `${meals.length} repas`;
  $("calorieBar").style.width = `${pct}%`;
}

function renderSelected() {
  const list = $("foodList");
  const count = state.selected.length;
  $("selectedTitle").textContent = `${count} aliment${count > 1 ? "s" : ""}`;
  $("clearSelectionBtn").hidden = count === 0;
  $("composeBtn").disabled = count === 0;
  $("composeHint").textContent = count
    ? `${count} aliment${count > 1 ? "s" : ""} prêt${count > 1 ? "s" : ""} à être réparti${count > 1 ? "s" : ""}.`
    : "Ajoute au moins un aliment.";

  if (!count) {
    list.className = "food-list empty-state";
    list.innerHTML = `<div class="empty-icon">🥫</div><p>Scanne les aliments que tu veux manger maintenant.</p>`;
    return;
  }

  list.className = "food-list";
  list.innerHTML = state.selected.map((food, index) => {
    const p = food.per100;
    return `
      <article class="food-item">
        <div>
          <h3>${escapeHtml(food.name)}</h3>
          <div class="food-meta">${escapeHtml(food.brand || "Sans marque")} · ${Math.round(food.available)} g disponibles</div>
          <div class="food-macros">
            <span>${round(p.kcal)} kcal/100g</span>
            <span>${round(p.protein)} g prot.</span>
            <span>${round(p.fiber)} g fibres</span>
          </div>
        </div>
        <button class="remove-food" data-remove="${index}" aria-label="Retirer">✕</button>
      </article>`;
  }).join("");

  list.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected.splice(Number(button.dataset.remove), 1);
      currentRecommendation = [];
      $("recommendationSection").hidden = true;
      saveState();
      render();
    });
  });
}

function renderHistory() {
  const meals = [...todayMeals()].reverse();
  const list = $("historyList");
  if (!meals.length) {
    list.innerHTML = `<div class="empty-state"><p>Aucun repas validé aujourd’hui.</p></div>`;
    return;
  }

  list.innerHTML = meals.map((meal) => {
    const time = new Date(meal.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const names = meal.items.map((x) => `${x.name} ${Math.round(x.grams)} g`).join(" · ");
    return `
      <article class="history-item">
        <div class="history-top">
          <strong>${time}</strong>
          <strong>${Math.round(meal.totals.kcal)} kcal</strong>
        </div>
        <p>${escapeHtml(names)}</p>
      </article>`;
  }).join("");
}

function render() {
  renderSummary();
  renderSelected();
  renderHistory();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function productWeight(product) {
  if (Number.isFinite(Number(product.product_quantity)) && Number(product.product_quantity) > 0) {
    return Number(product.product_quantity);
  }

  const text = String(product.quantity || "");
  const kg = text.match(/([\d.,]+)\s*kg/i);
  if (kg) return Number(kg[1].replace(",", ".")) * 1000;
  const g = text.match(/([\d.,]+)\s*g/i);
  if (g) return Number(g[1].replace(",", "."));
  return 500;
}

function nutrient(nutriments, key) {
  return numberOrZero(nutriments?.[`${key}_100g`]);
}

async function lookupBarcode(barcode) {
  const clean = String(barcode).replace(/\D/g, "");
  if (!clean) return;

  toast("Recherche du produit…");

  try {
    const fields = [
      "code", "product_name", "brands", "quantity", "product_quantity",
      "nutriments"
    ].join(",");
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?fields=${fields}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      openProductDialog({
        barcode: clean,
        source: "manual",
        name: "",
        brand: "",
        available: 500,
        per100: {}
      }, true);
      toast("Produit inconnu : complète l’étiquette une seule fois.");
      return;
    }

    const p = data.product;
    const n = p.nutriments || {};
    openProductDialog({
      barcode: clean,
      source: "openfoodfacts",
      name: p.product_name || "Produit sans nom",
      brand: p.brands || "",
      available: productWeight(p),
      per100: {
        kcal: nutrient(n, "energy-kcal"),
        protein: nutrient(n, "proteins"),
        carbs: nutrient(n, "carbohydrates"),
        fat: nutrient(n, "fat"),
        fiber: nutrient(n, "fiber"),
        salt: nutrient(n, "salt")
      }
    });
  } catch (error) {
    console.error(error);
    toast("Impossible de joindre Open Food Facts.");
  }
}

function openProductDialog(food = null, unknown = false) {
  $("productDialogTitle").textContent = unknown ? "Compléter le produit" : (food ? "Vérifier le produit" : "Ajouter un aliment");
  $("editBarcode").value = food?.barcode || "";
  $("editSource").value = food?.source || "manual";
  $("editName").value = food?.name || "";
  $("editBrand").value = food?.brand || "";
  $("editAvailable").value = food?.available || 100;
  $("editKcal").value = food?.per100?.kcal ?? "";
  $("editProtein").value = food?.per100?.protein ?? "";
  $("editCarbs").value = food?.per100?.carbs ?? "";
  $("editFat").value = food?.per100?.fat ?? "";
  $("editFiber").value = food?.per100?.fiber ?? 0;
  $("editSalt").value = food?.per100?.salt ?? 0;
  $("productDialog").showModal();
}

function formFood() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    barcode: $("editBarcode").value,
    source: $("editSource").value || "manual",
    name: $("editName").value.trim(),
    brand: $("editBrand").value.trim(),
    available: numberOrZero($("editAvailable").value),
    per100: {
      kcal: numberOrZero($("editKcal").value),
      protein: numberOrZero($("editProtein").value),
      carbs: numberOrZero($("editCarbs").value),
      fat: numberOrZero($("editFat").value),
      fiber: numberOrZero($("editFiber").value),
      salt: numberOrZero($("editSalt").value)
    }
  };
}

function targetForNextMeal() {
  const remaining = remainingTargets();
  const mealsAlready = todayMeals().length;
  const remainingMealCount = Math.max(1, state.settings.meals - mealsAlready);

  return {
    kcal: remaining.kcal / remainingMealCount,
    protein: remaining.protein / remainingMealCount,
    fiber: remaining.fiber / remainingMealCount
  };
}

function scoreAllocation(grams, foods, target) {
  const items = foods.map((food, i) => ({ ...food, grams: grams[i] }));
  const total = totalNutrition(items);

  const kcalErr = Math.abs(total.kcal - target.kcal) / Math.max(250, target.kcal);
  const proteinDeficit = Math.max(0, target.protein - total.protein) / Math.max(15, target.protein);
  const fiberDeficit = Math.max(0, target.fiber - total.fiber) / Math.max(5, target.fiber);
  const saltExcess = Math.max(0, total.salt - 2.2) / 2.2;
  const totalWeight = grams.reduce((a, b) => a + b, 0);
  const volumeExcess = Math.max(0, totalWeight - 1000) / 1000;

  let diversityPenalty = 0;
  if (foods.length > 1) {
    const usableFoods = foods.filter((f) => f.available >= 40 && f.per100.kcal > 0).length;
    const includedFoods = grams.filter((g) => g >= 40).length;
    diversityPenalty = Math.max(0, Math.min(usableFoods, 3) - includedFoods) * 0.05;
  }

  return (
    kcalErr * 8 +
    proteinDeficit * 2.2 +
    fiberDeficit * 1.2 +
    saltExcess * 2 +
    volumeExcess * 0.8 +
    diversityPenalty
  );
}

function composeMeal(foods, target) {
  const step = 10;
  const grams = foods.map((food) => {
    const n = foods.length;
    if (food.per100.kcal <= 0) return Math.min(food.available, 100);
    const equalKcal = target.kcal / n;
    const guess = (equalKcal / food.per100.kcal) * 100;
    return clamp(Math.round(guess / step) * step, 0, food.available);
  });

  let bestScore = scoreAllocation(grams, foods, target);

  for (let iteration = 0; iteration < 400; iteration++) {
    let improved = false;
    let bestMove = null;

    for (let i = 0; i < foods.length; i++) {
      for (const delta of [-step, step]) {
        const next = [...grams];
        next[i] = clamp(next[i] + delta, 0, foods[i].available);
        if (next[i] === grams[i]) continue;
        const candidate = scoreAllocation(next, foods, target);

        if (candidate + 0.000001 < bestScore && (!bestMove || candidate < bestMove.score)) {
          bestMove = { i, value: next[i], score: candidate };
        }
      }
    }

    if (bestMove) {
      grams[bestMove.i] = bestMove.value;
      bestScore = bestMove.score;
      improved = true;
    }

    if (!improved) break;
  }

  return foods
    .map((food, i) => ({ ...food, grams: Math.round(grams[i]) }))
    .filter((item) => item.grams > 0);
}

function renderRecommendation() {
  const container = $("recommendationList");
  container.innerHTML = currentRecommendation.map((item, index) => `
    <div class="rec-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <small>max. ${Math.round(item.available)} g disponible</small>
      </div>
      <input class="rec-grams" data-index="${index}" type="number" min="0" max="${item.available}" step="10" value="${Math.round(item.grams)}" aria-label="Grammes de ${escapeHtml(item.name)}">
    </div>
  `).join("");

  container.querySelectorAll(".rec-grams").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      currentRecommendation[index].grams = clamp(numberOrZero(input.value), 0, currentRecommendation[index].available);
      updateRecommendationTotals();
    });
  });

  updateRecommendationTotals();
  $("recommendationSection").hidden = false;
  $("recommendationSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateRecommendationTotals() {
  const totals = totalNutrition(currentRecommendation);
  const target = targetForNextMeal();

  $("recKcal").textContent = `${Math.round(totals.kcal)} kcal`;
  $("recProtein").textContent = `${round(totals.protein)} g`;
  $("recFiber").textContent = `${round(totals.fiber)} g`;
  $("recSalt").textContent = `${round(totals.salt, 2)} g`;

  const kcalDiff = totals.kcal - target.kcal;
  const note = [];
  note.push(`Cible calculée pour ce repas : ~${Math.round(target.kcal)} kcal.`);
  if (Math.abs(kcalDiff) <= target.kcal * 0.1) note.push("Les calories sont proches de la cible.");
  else if (kcalDiff < 0) note.push("Le repas reste sous la cible calorique.");
  else note.push("Le repas dépasse la cible calorique.");
  if (totals.protein < target.protein * 0.75) note.push("Les aliments sélectionnés rendent l’objectif de protéines difficile à atteindre.");
  if (totals.fiber >= target.fiber) note.push("Objectif de fibres du repas atteint.");
  $("recommendationNote").textContent = note.join(" ");
}

async function startScanner() {
  if (!window.Html5Qrcode) {
    toast("Scanner indisponible. Utilise la saisie du code-barres.");
    return;
  }

  $("scannerDialog").showModal();
  $("scannerStatus").textContent = "Démarrage de la caméra…";

  try {
    scanner = scanner || new Html5Qrcode("reader");
    if (scannerRunning) return;

    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 150 } },
      async (decodedText) => {
        if (!scannerRunning) return;
        await stopScanner();
        $("scannerDialog").close();
        lookupBarcode(decodedText);
      },
      () => {}
    );

    scannerRunning = true;
    $("scannerStatus").textContent = "Vise le code EAN/UPC. Le scan est automatique.";
  } catch (error) {
    console.error(error);
    scannerRunning = false;
    $("scannerStatus").textContent = "Caméra inaccessible. Vérifie l’autorisation ou saisis le code manuellement.";
  }
}

async function stopScanner() {
  if (scanner && scannerRunning) {
    try { await scanner.stop(); } catch {}
  }
  scannerRunning = false;
  const reader = $("reader");
  if (reader) reader.innerHTML = "";
  scanner = null;
}

$("scanBtn").addEventListener("click", startScanner);
$("manualBtn").addEventListener("click", () => openProductDialog());

$("barcodeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("barcodeInput").value;
  $("barcodeInput").value = "";
  lookupBarcode(code);
});

$("productForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const food = formFood();

  if (!food.name || food.available <= 0 || food.per100.kcal <= 0) {
    toast("Vérifie le nom, le poids consommable et les calories.");
    return;
  }

  const duplicateIndex = food.barcode
    ? state.selected.findIndex((x) => x.barcode === food.barcode)
    : -1;

  if (duplicateIndex >= 0) state.selected[duplicateIndex] = food;
  else state.selected.push(food);

  currentRecommendation = [];
  $("recommendationSection").hidden = true;
  saveState();
  $("productDialog").close();
  render();
  toast("Aliment ajouté.");
});

$("composeBtn").addEventListener("click", () => {
  if (!state.selected.length) return;
  const target = targetForNextMeal();

  if (target.kcal <= 0) {
    toast("Ton objectif calorique journalier est déjà atteint.");
    return;
  }

  currentRecommendation = composeMeal(state.selected, target);
  if (!currentRecommendation.length) {
    toast("Impossible de calculer des portions avec ces données.");
    return;
  }

  renderRecommendation();
});

$("validateMealBtn").addEventListener("click", () => {
  if (!currentRecommendation.length) return;

  const items = currentRecommendation
    .filter((item) => item.grams > 0)
    .map((item) => ({
      name: item.name,
      barcode: item.barcode || "",
      grams: round(item.grams),
      per100: item.per100
    }));

  const meal = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: todayKey(),
    timestamp: new Date().toISOString(),
    items,
    totals: totalNutrition(items)
  };

  state.history.push(meal);

  for (const consumed of currentRecommendation) {
    const selected = state.selected.find((item) => item.id === consumed.id);
    if (selected) selected.available = Math.max(0, selected.available - consumed.grams);
  }
  state.selected = state.selected.filter((item) => item.available > 0);

  currentRecommendation = [];
  $("recommendationSection").hidden = true;
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Repas enregistré.");
});

$("clearSelectionBtn").addEventListener("click", () => {
  state.selected = [];
  currentRecommendation = [];
  $("recommendationSection").hidden = true;
  saveState();
  render();
});

$("settingsBtn").addEventListener("click", () => {
  $("settingCalories").value = state.settings.calories;
  $("settingProtein").value = state.settings.protein;
  $("settingFiber").value = state.settings.fiber;
  $("settingMeals").value = state.settings.meals;
  $("settingsDialog").showModal();
});

$("settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = {
    calories: numberOrZero($("settingCalories").value),
    protein: numberOrZero($("settingProtein").value),
    fiber: numberOrZero($("settingFiber").value),
    meals: numberOrZero($("settingMeals").value)
  };
  saveState();
  $("settingsDialog").close();
  render();
  toast("Objectifs enregistrés.");
});

document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", async () => {
    const dialog = $(button.dataset.dialog);
    if (button.dataset.dialog === "scannerDialog") await stopScanner();
    dialog.close();
  });
});

$("scannerDialog").addEventListener("cancel", async () => {
  await stopScanner();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

render();
