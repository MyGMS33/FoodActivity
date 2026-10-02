const STORAGE_KEY = "foodactivity-v0";
const DEFAULT_STATE = {
  settings: { calories: 2000, protein: 120, fiber: 30, meals: 2 },
  selected: [],
  history: []
};

let state = loadState();
let scanner = null;
let scannerRunning = false;
let cameraStream = null;
let scanTimer = null;
let scanBusy = false;
let digitalZoom = 1;
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
  const metricCalories = $("metricCalories");
  if (metricCalories) metricCalories.textContent = `${Math.round(used.kcal)} / ${state.settings.calories}`;
  const ringPercent = $("ringPercent");
  if (ringPercent) ringPercent.textContent = `${Math.round(pct)}%`;
  const ring = document.querySelector(".ring");
  if (ring) ring.style.setProperty("--ring", `${pct}%`);
  const remainingCalories = $("remainingCalories");
  if (remainingCalories) remainingCalories.textContent = `${Math.round(remaining)} kcal`;
  const mealCounter = $("mealCounter");
  if (mealCounter) mealCounter.textContent = `${meals.length} repas`;
  $("calorieBar").style.width = `${pct}%`;
}

function renderSelected() {
  const list = $("foodList");
  const count = state.selected.length;
  $("selectedTitle").textContent = `${count} aliment${count > 1 ? "s" : ""}`;
  $("clearSelectionBtn").hidden = count === 0;
  $("composeBtn").disabled = count === 0;
  const stickyCompose = document.querySelector(".sticky-compose");
  if (stickyCompose) stickyCompose.hidden = count === 0;

  const scannerCount = $("scannerDetectedCount");
  if (scannerCount) scannerCount.textContent = String(count);
  const scannerList = $("scannerFoodList");
  if (scannerList) {
    scannerList.innerHTML = count
      ? state.selected.map((food) => `
          <div class="scanner-food-mini">
            <div>
              <strong>${escapeHtml(food.name)}</strong>
              <small>${Math.round(food.available)} g disponibles · ${round(food.per100.kcal)} kcal/100g</small>
            </div>
            <span class="scanner-check">✓</span>
          </div>`).join("")
      : '<div class="muted">Aucun produit détecté pour le moment.</div>';
  }

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

function zxingReader() {
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) return null;
  if (!scanner) scanner = new ZXingBrowser.BrowserMultiFormatReader();
  return scanner;
}

function scoreCamera(device) {
  const label = (device.label || "").toLowerCase();
  let score = 0;
  if (/camera2\s*0/.test(label)) score += 100;
  if (/back|rear|environment|arrière|trasera|achter/.test(label)) score += 60;
  if (/main|wide/.test(label) && !/ultra/.test(label)) score += 15;
  if (/front|user|selfie|avant/.test(label)) score -= 150;
  if (/ultra|0\.6|macro|depth/.test(label)) score -= 15;
  return score;
}

async function bestRearCameraDevice() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "videoinput");
    if (!devices.length) return null;
    return [...devices].sort((a, b) => scoreCamera(b) - scoreCamera(a))[0] || null;
  } catch {
    return null;
  }
}

async function requestCameraStream() {
  const baseVideo = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 }
  };

  let preferred = await bestRearCameraDevice();

  // On Android, labels can be hidden until camera permission has been granted once.
  if (!preferred || !(preferred.label || "").trim()) {
    const permissionStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...baseVideo, facingMode: { ideal: "environment" } }
    });

    const permissionTrack = permissionStream.getVideoTracks()[0];
    const firstSettings = permissionTrack?.getSettings?.() || {};
    const firstDeviceId = firstSettings.deviceId || null;

    preferred = await bestRearCameraDevice();

    if (!preferred || !preferred.deviceId || preferred.deviceId === firstDeviceId) {
      return permissionStream;
    }

    permissionStream.getTracks().forEach((track) => track.stop());
  }

  if (preferred?.deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...baseVideo, deviceId: { exact: preferred.deviceId } }
      });
    } catch (error) {
      console.warn("Caméra arrière préférée refusée, fallback environment", error);
    }
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { ...baseVideo, facingMode: { ideal: "environment" } }
  });
}

async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Ce navigateur ne permet pas l’accès à la caméra.");
    return;
  }

  if (!zxingReader()) {
    toast("Le lecteur de code-barres n’a pas chargé. Recharge l’application.");
    return;
  }

  if (!$("scannerDialog").open) $("scannerDialog").showModal();
  $("scannerStatus").textContent = "Ouverture de la caméra intégrée…";

  try {
    await stopScanner();

    cameraStream = await requestCameraStream();
    const video = $("cameraVideo");
    if (!video) throw new Error("Élément vidéo introuvable");

    video.srcObject = cameraStream;
    video.classList.remove("digital-zoom-2");
    digitalZoom = 1;
    updateZoomButtons(1);

    await video.play();
    scannerRunning = true;

    await enableContinuousFocus();
    const track = getCameraTrack();
    const label = track?.label ? ` — ${track.label}` : "";
    $("scannerStatus").textContent =
      `Caméra prête${label}. Pour un petit code, centre-le puis essaie 2× et « Mise au point ».`;

    scheduleDecode();
  } catch (error) {
    console.error("Camera start error", error);
    scannerRunning = false;
    const name = error?.name || "";
    let message = "Impossible d’ouvrir la caméra.";
    if (name === "NotAllowedError" || name === "SecurityError") {
      message = "Accès caméra refusé. Dans Android : Paramètres > Applications > Chrome > Autorisations > Caméra > Autoriser.";
    } else if (name === "NotReadableError") {
      message = "La caméra est déjà utilisée ou bloquée. Ferme l’appareil photo/une autre appli caméra puis réessaie.";
    } else if (name === "OverconstrainedError") {
      message = "Cette caméra refuse les réglages demandés. Réessaie : FoodActivity utilisera un réglage plus simple.";
    }
    $("scannerStatus").textContent = message;
    toast(message);
  }
}

function getCameraTrack() {
  return cameraStream?.getVideoTracks?.()[0] || null;
}

function getCameraCapabilities() {
  try {
    return getCameraTrack()?.getCapabilities?.() || {};
  } catch {
    return {};
  }
}

async function applyTrackConstraints(constraints) {
  const track = getCameraTrack();
  if (!track?.applyConstraints) throw new Error("Contraintes caméra indisponibles");
  return track.applyConstraints(constraints);
}

async function enableContinuousFocus() {
  const caps = getCameraCapabilities();
  const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
  if (!modes.includes("continuous")) return false;
  try {
    await applyTrackConstraints({ advanced: [{ focusMode: "continuous" }] });
    return true;
  } catch {
    return false;
  }
}

function updateZoomButtons(value) {
  const one = $("zoom1Btn");
  const two = $("zoom2Btn");
  if (one) one.classList.toggle("active", value < 1.5);
  if (two) two.classList.toggle("active", value >= 1.5);
}

async function setCameraZoom(targetZoom) {
  if (!scannerRunning) {
    toast("Ouvre d’abord la caméra.");
    return;
  }

  const caps = getCameraCapabilities();
  const zoom = caps.zoom;
  const video = $("cameraVideo");

  if (zoom && Number.isFinite(Number(zoom.min)) && Number.isFinite(Number(zoom.max))) {
    const value = clamp(Number(targetZoom), Number(zoom.min), Number(zoom.max));
    try {
      await applyTrackConstraints({ advanced: [{ zoom: value }] });
      digitalZoom = 1;
      video?.classList.remove("digital-zoom-2");
      updateZoomButtons(value);
      $("scannerStatus").textContent = `Zoom matériel ${round(value, 1)}× actif.`;
      return;
    } catch (error) {
      console.warn("Zoom matériel refusé", error);
    }
  }

  // Fallback: croppe réellement l'image haute définition avant décodage.
  digitalZoom = targetZoom >= 2 ? 2 : 1;
  video?.classList.toggle("digital-zoom-2", digitalZoom === 2);
  updateZoomButtons(digitalZoom);
  $("scannerStatus").textContent =
    digitalZoom === 2
      ? "Zoom 2× logiciel actif : le centre de l’image est agrandi aussi pour le lecteur de code-barres."
      : "Zoom 1× actif.";
}

async function refocusCamera() {
  if (!scannerRunning) {
    toast("Ouvre d’abord la caméra.");
    return;
  }

  const caps = getCameraCapabilities();
  const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];

  try {
    if (modes.includes("single-shot")) {
      await applyTrackConstraints({ advanced: [{ focusMode: "single-shot" }] });
      $("scannerStatus").textContent = "Mise au point relancée.";
      setTimeout(() => enableContinuousFocus(), 650);
      return;
    }
    if (modes.includes("continuous")) {
      await applyTrackConstraints({ advanced: [{ focusMode: "continuous" }] });
      $("scannerStatus").textContent = "Autofocus continu activé.";
      return;
    }
  } catch (error) {
    console.warn("Autofocus direct indisponible", error);
  }

  // Un redémarrage du flux force généralement Android à refaire l'autofocus.
  $("scannerStatus").textContent = "Nouvelle mise au point…";
  await stopScanner();
  await new Promise((resolve) => setTimeout(resolve, 180));
  await startScanner();
}

function scheduleDecode() {
  clearTimeout(scanTimer);
  if (!scannerRunning) return;
  scanTimer = setTimeout(decodeCurrentFrame, 110);
}

async function decodeCurrentFrame() {
  if (!scannerRunning || scanBusy) {
    scheduleDecode();
    return;
  }

  const video = $("cameraVideo");
  const canvas = $("scanCanvas");
  const reader = zxingReader();

  if (!video || !canvas || !reader || video.readyState < 2 || !video.videoWidth) {
    scheduleDecode();
    return;
  }

  scanBusy = true;

  try {
    const sourceW = video.videoWidth;
    const sourceH = video.videoHeight;
    const zoom = digitalZoom >= 2 ? 2 : 1;
    const cropW = sourceW / zoom;
    const cropH = sourceH / zoom;
    const sx = (sourceW - cropW) / 2;
    const sy = (sourceH - cropH) / 2;

    const targetW = Math.min(1280, Math.max(640, Math.round(cropW)));
    const targetH = Math.round(targetW * (cropH / cropW));
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, targetW, targetH);

    const result = reader.decodeFromCanvas(canvas);
    const code = result?.getText?.() || result?.text;
    if (code) {
      await stopScanner();
      $("scannerDialog").close();
      lookupBarcode(String(code));
      return;
    }
  } catch (error) {
    // "Not found" between frames is normal during live scanning.
  } finally {
    scanBusy = false;
  }

  scheduleDecode();
}

async function scanBarcodePhoto(file) {
  if (!file || !zxingReader()) return;
  $("scannerStatus").textContent = "Analyse de la photo du code-barres…";

  const url = URL.createObjectURL(file);
  try {
    await stopScanner();
    const result = await zxingReader().decodeFromImageUrl(url);
    const decodedText = result?.getText?.() || result?.text;
    if (!decodedText) throw new Error("Code non reconnu");
    $("scannerDialog").close();
    lookupBarcode(String(decodedText));
  } catch (error) {
    console.error(error);
    $("scannerStatus").textContent =
      "Code non reconnu sur la photo. Prends la photo plus près, bien nette et sans reflet.";
    toast("Code-barres non reconnu sur la photo.");
  } finally {
    URL.revokeObjectURL(url);
    const input = $("barcodePhotoInput");
    if (input) input.value = "";
  }
}

async function stopScanner() {
  clearTimeout(scanTimer);
  scanTimer = null;
  scanBusy = false;
  scannerRunning = false;

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  const video = $("cameraVideo");
  if (video) {
    try { video.pause(); } catch {}
    video.srcObject = null;
    video.classList.remove("digital-zoom-2");
  }
}

$("scanBtn").addEventListener("click", startScanner);
$("manualBtn").addEventListener("click", () => openProductDialog());

const barcodePhotoInput = $("barcodePhotoInput");
if (barcodePhotoInput) {
  barcodePhotoInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) scanBarcodePhoto(file);
  });
}

const zoom1Btn = $("zoom1Btn");
if (zoom1Btn) zoom1Btn.addEventListener("click", () => setCameraZoom(1));

const zoom2Btn = $("zoom2Btn");
if (zoom2Btn) zoom2Btn.addEventListener("click", () => setCameraZoom(2));

const refocusBtn = $("refocusBtn");
if (refocusBtn) refocusBtn.addEventListener("click", refocusCamera);

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
  document.body.classList.remove("recommendation-mode");
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

  document.body.classList.add("recommendation-mode");
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
  document.body.classList.remove("recommendation-mode");
  saveState();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Repas enregistré.");
});

$("clearSelectionBtn").addEventListener("click", () => {
  state.selected = [];
  currentRecommendation = [];
  $("recommendationSection").hidden = true;
  document.body.classList.remove("recommendation-mode");
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
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none"
      });
      registration.update().catch(() => {});
    } catch (error) {
      console.error(error);
    }
  });
}

render();


const recommendationBackBtn = $("recommendationBackBtn");
if (recommendationBackBtn) {
  recommendationBackBtn.addEventListener("click", () => {
    document.body.classList.remove("recommendation-mode");
    $("recommendationSection").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

const adjustMealBtn = $("adjustMealBtn");
if (adjustMealBtn) {
  adjustMealBtn.addEventListener("click", () => {
    const first = document.querySelector(".rec-grams");
    if (first) {
      first.focus();
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Tu peux modifier directement les quantités.");
    }
  });
}
