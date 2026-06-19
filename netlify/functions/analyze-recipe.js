// netlify/functions/analyze-recipe.js

const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "JSON invalide" };
  }

  const { image } = body;
  if (!image) return { statusCode: 400, body: "Champ 'image' manquant" };

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return { statusCode: 500, body: "Clé OpenAI manquante" };

  const prompt = `Tu es un assistant culinaire. Analyse cette image et extrais la recette.
Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans texte autour) avec cette structure exacte :
{
  "name": "Nom de la recette",
  "tags": ["tag1", "tag2"],
  "time": 30,
  "difficulty": "facile",
  "servings": 4,
  "ingredients": [
    { "name": "Tomates", "qty": "3", "unit": "pièces" },
    { "name": "Huile d'olive", "qty": "2", "unit": "cs" }
  ],
  "steps": [
    "Étape 1 : ...",
    "Étape 2 : ..."
  ]
}

Règles :
- "time" est un nombre entier en minutes (ou null si inconnu)
- "difficulty" est soit "facile", "moyen" ou "difficile" (ou null)
- "servings" est un entier (ou null)
- "qty" est toujours une chaîne de caractères
- "tags" sont des mots-clés utiles (ex: "végétarien", "rapide", "poulet")
- Si l'image ne contient pas de recette, retourne { "error": "Aucune recette détectée" }`;

  const payload = JSON.stringify({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text",      text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}`, detail: "high" } }
        ]
      }
    ]
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path:     "/v1/chat/completions",
        method:   "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`,
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let raw = "";
        res.on("data", chunk => raw += chunk);
        res.on("end", () => {
          try {
            const parsed  = JSON.parse(raw);
            const content = parsed.choices?.[0]?.message?.content || "";

            // Nettoie les éventuels blocs markdown ```json ... ```
            const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
            const recipe  = JSON.parse(cleaned);

            if (recipe.error) {
              resolve({ statusCode: 422, body: JSON.stringify({ error: recipe.error }) });
            } else {
              resolve({ statusCode: 200, body: JSON.stringify(recipe) });
            }
          } catch (e) {
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Parsing GPT échoué", raw }) });
          }
        });
      }
    );

    req.on("error", (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });

    req.write(payload);
    req.end();
  });
};

