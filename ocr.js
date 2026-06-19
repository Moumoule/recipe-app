// ─────────────────────────────────────────
// ocr.js — Analyse photo → recette via OpenAI Vision
// ─────────────────────────────────────────

const OCR_ENDPOINT = "/.netlify/functions/analyze-recipe";

let scanAbortController = null;

// ─────────────────────────────────────────
// APPEL API — Envoie le base64 à la Netlify Function
// Retourne { name, tags, time, difficulty, servings, ingredients, steps }
// ─────────────────────────────────────────
async function scanRecipeFromPhoto(base64) {
  scanAbortController = new AbortController();

  const response = await fetch(OCR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64 }),
    signal: scanAbortController.signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur serveur (${response.status}) : ${err}`);
  }

  const data = await response.json();

  // Normalise pour garantir tous les champs attendus par app.js
  return {
    name:        data.name        || "Recette inconnue",
    tags:        Array.isArray(data.tags)        ? data.tags        : [],
    time:        data.time        || null,
    difficulty:  data.difficulty  || null,
    servings:    data.servings    || null,
    ingredients: Array.isArray(data.ingredients) ? data.ingredients.map(i => ({
      name: i.name || "",
      qty:  i.qty  || i.quantity || "",
      unit: i.unit || ""
    })) : [],
    steps: Array.isArray(data.steps) ? data.steps : []
  };
}

// ─────────────────────────────────────────
// ANNULER L'ANALYSE EN COURS
// ─────────────────────────────────────────
function abortScan() {
  if (scanAbortController) {
    scanAbortController.abort();
    scanAbortController = null;
  }
}

