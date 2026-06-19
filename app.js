// app.js

// ─────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
let recipes = [];
let selectedRecipes = [];
let activeFilters = { type: null, time: null, difficulty: null };
let editingIndex = null;
let weekMenu = Array(7).fill(null);
let scanFile = null;
let scanAborted = false;
let scannedRecipe = null;

const EXTRAS_KEY = "meal_manager_extras";
const EXTRA_CATEGORIES = [
  "🧴 Hygiène", "🍷 Alcool / Boissons", "🏠 Maison",
  "🐾 Animaux", "💊 Santé", "🛒 Autres"
];
let extras = JSON.parse(localStorage.getItem(EXTRAS_KEY) || "[]");

// ─────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  currentUser = session?.user ?? null;

  if (currentUser) {
    document.getElementById("screen-auth").classList.add("hidden");
    document.getElementById("screen-app").classList.remove("hidden");
    await loadRecipes();
    await loadSelected();
    initTheme();
    renderFilterButtons();
    renderRecipes();
    renderSelected();
    renderShopping();
    renderExtras();
    setupImport();
  } else {
    document.getElementById("screen-auth").classList.remove("hidden");
    document.getElementById("screen-app").classList.add("hidden");
  }
});

async function loginUser() {
  const email    = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errEl    = document.getElementById("auth-error");
  errEl.style.color = "red";
  errEl.textContent = "";

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) errEl.textContent = "❌ Email ou mot de passe incorrect";
}

async function registerUser() {
  const email    = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errEl    = document.getElementById("auth-error");
  errEl.style.color = "red";
  errEl.textContent = "";

  const { error } = await sb.auth.signUp({ email, password });
  if (error) {
    errEl.textContent = "❌ " + error.message;
  } else {
    errEl.style.color = "green";
    errEl.textContent = "✅ Compte créé ! Vérifie tes emails.";
  }
}

async function logoutUser() {
  await sb.auth.signOut();
}

function togglePassword() {
  const input = document.getElementById("auth-password");
  const icon  = document.getElementById("btn-eye").querySelector("span");
  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "visibility_off";
  } else {
    input.type = "password";
    icon.textContent = "visibility";
  }
}

// ─────────────────────────────────────────
// SAVE / LOAD RECIPES (Supabase)
// ─────────────────────────────────────────
async function loadRecipes() {
  const { data, error } = await sb
    .from("recipes")
    .select("id, data")
    .eq("user_id", currentUser.id);

  if (error) { console.error(error); return; }

  recipes = (data || []).map(row => ({ ...row.data, _supaId: row.id }));
}

async function saveRecipeToSupabase(recipe) {
  const { _supaId, ...data } = recipe;

  if (_supaId) {
    await sb.from("recipes").update({ data }).eq("id", _supaId);
  } else {
    const { data: inserted, error } = await sb
      .from("recipes")
      .insert({ user_id: currentUser.id, data })
      .select()
      .single();
    if (!error) recipe._supaId = inserted.id;
  }
}

async function deleteRecipeFromSupabase(supaId) {
  await sb.from("recipes").delete().eq("id", supaId);
}

// ─────────────────────────────────────────
// SAVE / LOAD SELECTED (Supabase)
// ─────────────────────────────────────────
async function loadSelected() {
  const { data, error } = await sb
    .from("selected_recipes")
    .select("data")
    .eq("user_id", currentUser.id)
    .single();

  if (error || !data) { selectedRecipes = []; return; }
  selectedRecipes = data.data || [];
}

async function saveSelected() {
  // upsert : une seule ligne par user
  await sb.from("selected_recipes").upsert(
    { user_id: currentUser.id, data: selectedRecipes },
    { onConflict: "user_id" }
  );
}

// ─────────────────────────────────────────
// THEME
// ─────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}

// ─────────────────────────────────────────
// IMPORT JSON
// ─────────────────────────────────────────
function triggerImport() {
  document.getElementById("import-json").click();
}

function setupImport() {
  const input = document.getElementById("import-json");
  input.addEventListener("change", async function () {
    const file = this.files[0];
    if (!file) return;

    showToast("⏳ Lecture en cours...");
    const reader = new FileReader();

    reader.onload = async function (evt) {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) {
          showToast("❌ Format invalide : tableau JSON requis.");
          return;
        }

        for (const r of imported) {
          const { _supaId, ...data } = r;
          const { data: inserted, error } = await sb
            .from("recipes")
            .insert({ user_id: currentUser.id, data })
            .select()
            .single();
          if (!error) recipes.push({ ...data, _supaId: inserted.id });
        }

        renderFilterButtons();
        renderRecipes();
        showToast(`✅ ${imported.length} recettes importées !`);
      } catch (err) {
        showToast("❌ JSON invalide : " + err.message);
      }
    };

    reader.readAsText(file, "UTF-8");
    this.value = "";
  });
}

// ─────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────
function showToast(msg) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed; bottom:90px; left:50%; transform:translateX(-50%);
    background:#1e293b; color:white; padding:12px 20px;
    border-radius:12px; font-size:14px; z-index:9999;
    box-shadow:0 4px 20px rgba(0,0,0,0.4); white-space:nowrap;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─────────────────────────────────────────
// FILTRES
// ─────────────────────────────────────────
function renderFilterButtons() {
  const allTags = new Set();
  recipes.forEach(r => (r.tags || []).forEach(t => allTags.add(t)));

  const typeEl = document.getElementById("filter-type");
  const timeEl = document.getElementById("filter-time");
  const diffEl = document.getElementById("filter-difficulty");

  typeEl.innerHTML = "";
  timeEl.innerHTML = "";
  diffEl.innerHTML = "";

  allTags.forEach(tag => typeEl.appendChild(makeFilterBtn("type", tag, tag)));

  [
    { value: "rapide", label: "⚡ Rapide (< 25 min)" },
    { value: "moyen",  label: "⏱️ Moyen (25–45 min)" },
    { value: "long",   label: "🕐 Long (> 45 min)" }
  ].forEach(({ value, label }) => timeEl.appendChild(makeFilterBtn("time", value, label)));

  [
    { value: "facile",    label: "🟢 Facile" },
    { value: "moyen",     label: "🟡 Moyen" },
    { value: "difficile", label: "🔴 Difficile" }
  ].forEach(({ value, label }) => diffEl.appendChild(makeFilterBtn("difficulty", value, label)));
}

function makeFilterBtn(type, value, label) {
  const btn = document.createElement("button");
  btn.className = "filter-btn";
  btn.dataset.type  = type;
  btn.dataset.value = value;
  btn.textContent   = label;
  btn.onclick = () => toggleFilter(type, value);
  return btn;
}

function toggleFilter(type, value) {
  activeFilters[type] = activeFilters[type] === value ? null : value;
  renderRecipes();
  updateFilterUI();
}

function updateFilterUI() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.classList.toggle("active", activeFilters[btn.dataset.type] === btn.dataset.value);
  });
}

function recipeMatchesFilters(r) {
  if (activeFilters.type && !(r.tags || []).includes(activeFilters.type)) return false;
  if (activeFilters.difficulty && r.difficulty !== activeFilters.difficulty) return false;
  if (activeFilters.time) {
    const t = r.time || 0;
    if (activeFilters.time === "rapide" && t >= 25) return false;
    if (activeFilters.time === "moyen"  && (t < 25 || t > 45)) return false;
    if (activeFilters.time === "long"   && t <= 45) return false;
  }
  return true;
}

// ─────────────────────────────────────────
// RENDER RECETTES
// ─────────────────────────────────────────
function renderRecipes() {
  const list   = document.getElementById("recipes-list");
  const search = document.getElementById("search-input")?.value.toLowerCase() || "";
  list.innerHTML = "";

  let filtered = recipes.filter(r =>
    r.name.toLowerCase().includes(search) && recipeMatchesFilters(r)
  );
  filtered.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  filtered.forEach(recipe => {
    const realIndex = recipes.indexOf(recipe);
    const isSelected = selectedRecipes.some(r => r._index === realIndex);

    const li = document.createElement("li");
    li.className = "recipe-card";

    const header = document.createElement("div");
    header.className = "recipe-card-header";

    const titleWrap = document.createElement("div");

    const title = document.createElement("div");
    title.className = "recipe-title";
    title.textContent = recipe.name;

    const meta = document.createElement("div");
    meta.className = "recipe-meta";
    const parts = [];
    if (recipe.time)       parts.push(`⏱️ ${recipe.time} min`);
    if (recipe.difficulty) parts.push(`• ${recipe.difficulty}`);
    if (recipe.servings)   parts.push(`• ${recipe.servings} pers.`);
    meta.textContent = parts.join(" ");

    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);

    const editBtn = document.createElement("button");
    editBtn.className = "btn-select";
    editBtn.title = "Modifier";
    editBtn.innerHTML = `<span class="material-symbols-outlined" style="color:var(--muted);">edit</span>`;
    editBtn.onclick = e => { e.stopPropagation(); openEditor(realIndex); };

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-select";
    deleteBtn.title = "Supprimer";
    deleteBtn.innerHTML = `<span class="material-symbols-outlined" style="color:#f87171;">delete</span>`;
    deleteBtn.onclick = e => { e.stopPropagation(); deleteRecipe(realIndex); };

    const selectBtn = document.createElement("button");
    selectBtn.className = "btn-select" + (isSelected ? " selected" : "");
    selectBtn.innerHTML = `<span class="material-symbols-outlined">${isSelected ? "check_circle" : "add_circle"}</span>`;
    selectBtn.onclick = e => { e.stopPropagation(); toggleSelect(realIndex); };

    header.appendChild(titleWrap);
    header.appendChild(editBtn);
    header.appendChild(deleteBtn);
    header.appendChild(selectBtn);

    const tagsDiv = document.createElement("div");
    tagsDiv.className = "recipe-tags";
    (recipe.tags || []).forEach(tag => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      tagsDiv.appendChild(span);
    });

    li.appendChild(header);
    li.appendChild(tagsDiv);
    li.onclick = () => openViewer(realIndex);
    list.appendChild(li);
  });
}

// ─────────────────────────────────────────
// SUPPRESSION
// ─────────────────────────────────────────
async function deleteRecipe(index) {
  if (!confirm(`Supprimer "${recipes[index].name}" ?`)) return;

  const supaId = recipes[index]._supaId;
  if (supaId) await deleteRecipeFromSupabase(supaId);

  selectedRecipes = selectedRecipes
    .filter(r => r._index !== index)
    .map(r => ({ ...r, _index: r._index > index ? r._index - 1 : r._index }));

  recipes.splice(index, 1);
  await saveSelected();
  renderFilterButtons();
  renderRecipes();
  renderSelected();
  renderShopping();
  showToast("🗑️ Recette supprimée");
}

// ─────────────────────────────────────────
// SELECTION
// ─────────────────────────────────────────
async function toggleSelect(index) {
  const existing = selectedRecipes.find(r => r._index === index);
  if (existing) {
    selectedRecipes = selectedRecipes.filter(r => r._index !== index);
  } else {
    selectedRecipes.push({ ...recipes[index], _index: index, multiplier: 1 });
  }
  await saveSelected();
  renderRecipes();
  renderSelected();
  renderShopping();
}

async function changeMultiplier(i, delta) {
  selectedRecipes[i].multiplier = Math.max(1, (selectedRecipes[i].multiplier || 1) + delta);
  await saveSelected();
  renderSelected();
  renderShopping();
}

async function clearSelection() {
  if (!confirm("Vider toute la sélection ?")) return;
  selectedRecipes = [];
  await saveSelected();
  renderRecipes();
  renderSelected();
  renderShopping();
}

// ─────────────────────────────────────────
// RENDER SELECTION
// ─────────────────────────────────────────
function renderSelected() {
  const container = document.getElementById("selected-recipes");
  if (!container) return;
  container.innerHTML = "";

  if (!selectedRecipes.length) {
    container.innerHTML = `
      <div style="text-align:center; margin-top:48px; color:var(--muted);">
        <span class="material-symbols-outlined" style="font-size:48px;">restaurant_menu</span>
        <p>Aucune recette sélectionnée</p>
        <p style="font-size:13px;">Ajoute des recettes depuis l'onglet Recettes</p>
      </div>`;
    return;
  }

  selectedRecipes.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "selected-card";

    const header = document.createElement("div");
    header.className = "selected-card-header";

    const name = document.createElement("div");
    name.className = "selected-card-name";
    name.textContent = r.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-remove";
    removeBtn.innerHTML = `<span class="material-symbols-outlined">delete</span>`;
    removeBtn.onclick = async () => {
      selectedRecipes.splice(i, 1);
      await saveSelected();
      renderRecipes();
      renderSelected();
      renderShopping();
    };

    header.appendChild(name);
    header.appendChild(removeBtn);

    const meta = document.createElement("div");
    meta.className = "recipe-meta";
    const parts = [];
    if (r.time)       parts.push(`⏱️ ${r.time} min`);
    if (r.difficulty) parts.push(`• ${r.difficulty}`);
    if (r.servings)   parts.push(`• ${r.servings} pers. de base`);
    meta.textContent = parts.join(" ");

    const tagsDiv = document.createElement("div");
    tagsDiv.className = "recipe-tags";
    (r.tags || []).forEach(tag => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      tagsDiv.appendChild(span);
    });

    const divider = document.createElement("hr");
    divider.style.cssText = "border:none; border-top:1px solid var(--divider); margin:4px 0;";

    const multRow = document.createElement("div");
    multRow.className = "multiplier-control";

    const label = document.createElement("span");
    label.className = "multiplier-label";
    label.textContent = "Portions :";

    const minusBtn = document.createElement("button");
    minusBtn.className = "btn-multiplier";
    minusBtn.innerHTML = `<span class="material-symbols-outlined">remove</span>`;
    minusBtn.onclick = () => changeMultiplier(i, -1);

    const valueEl = document.createElement("span");
    valueEl.className = "multiplier-value";
    valueEl.textContent = r.multiplier || 1;

    const plusBtn = document.createElement("button");
    plusBtn.className = "btn-multiplier";
    plusBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
    plusBtn.onclick = () => changeMultiplier(i, 1);

    const totalPortions = document.createElement("span");
    totalPortions.style.cssText = "margin-left:auto; font-size:12px; color:var(--muted);";
    totalPortions.textContent = `= ${(r.servings || 1) * (r.multiplier || 1)} pers.`;

    multRow.appendChild(label);
    multRow.appendChild(minusBtn);
    multRow.appendChild(valueEl);
    multRow.appendChild(plusBtn);
    multRow.appendChild(totalPortions);

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(tagsDiv);
    card.appendChild(divider);
    card.appendChild(multRow);
    container.appendChild(card);
  });
}

// ─────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────
function renderShopping() {
  const list = document.getElementById("shopping-list");
  if (!list) return;
  list.innerHTML = "";

  if (!selectedRecipes.length && !extras.filter(e => !e.checked).length) {
    list.innerHTML = `<p style="color:var(--muted); text-align:center; margin-top:32px;">Ajoute des recettes ou des extras pour générer la liste</p>`;
    return;
  }

  const merged = {};
  selectedRecipes.forEach(r => {
    const mult = r.multiplier || 1;
    (r.ingredients || []).forEach(ing => {
      const key = (ing.name || "").toLowerCase();
      if (!merged[key]) merged[key] = { name: ing.name, qty: 0, unit: ing.unit || "" };
      merged[key].qty += (parseFloat(ing.qty) || 0) * mult;
    });
  });

  function getCategory(name) {
    const n = name.toLowerCase();
    if (["poulet","boeuf","porc","steak","jambon","lardon","saucisse","merguez","canard","viande","bavette","escalope","filet"].some(w => n.includes(w))) return "🥩 Viandes";
    if (["carotte","tomate","courgette","salade","oignon","ail","poivron","legume","champignon","pois chiche","lentille","haricot"].some(w => n.includes(w))) return "🥦 Légumes & légumineuses";
    if (["pomme","banane","orange","citron"].some(w => n.includes(w))) return "🍎 Fruits";
    if (["lait","fromage","yaourt","beurre","creme","crème"].some(w => n.includes(w))) return "🥛 Produits laitiers";
    if (["riz","pate","pâte","semoule","farine","nouille","chapelure","lasagne"].some(w => n.includes(w))) return "🍝 Féculents";
    if (["sel","poivre","huile","vinaigre","sucre","epice","épice","curry","paprika","moutarde","miel","sauce","cumin"].some(w => n.includes(w))) return "🧂 Condiments & épices";
    return "🛒 Autres";
  }

  const categories = {};
  Object.values(merged).forEach(ing => {
    const cat = getCategory(ing.name);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(ing);
  });

  const catOrder = ["🥩 Viandes","🥦 Légumes & légumineuses","🍎 Fruits","🍝 Féculents","🥛 Produits laitiers","🧂 Condiments & épices","🛒 Autres"];

  catOrder.forEach(cat => {
    if (!categories[cat]) return;

    const title = document.createElement("li");
    title.style.cssText = "list-style:none; font-weight:bold; margin-top:16px; margin-bottom:4px; color:var(--muted); font-size:13px;";
    title.textContent = cat;
    list.appendChild(title);

    categories[cat].forEach(ing => {
      const li = document.createElement("li");
      li.className = "shopping-card";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";

      const qtyDisplay = Number.isInteger(ing.qty) ? ing.qty : parseFloat(ing.qty.toFixed(2));
      const label = document.createElement("span");
      label.textContent = `${qtyDisplay} ${ing.unit} — ${ing.name}`;

      checkbox.onchange = () => li.classList.toggle("checked", checkbox.checked);

      li.appendChild(checkbox);
      li.appendChild(label);
      list.appendChild(li);
    });
  });

  const uncheckedExtras = extras.filter(e => !e.checked);
  if (uncheckedExtras.length) {
    const title = document.createElement("li");
    title.style.cssText = "list-style:none; font-weight:bold; margin-top:16px; margin-bottom:4px; color:var(--muted); font-size:13px;";
    title.textContent = "✏️ Extras";
    list.appendChild(title);

    uncheckedExtras.forEach(item => {
      const li = document.createElement("li");
      li.className = "shopping-card";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.onchange = () => {
        const idx = extras.indexOf(item);
        extras[idx].checked = true;
        saveExtras();
        renderExtras();
        renderShopping();
      };

      const label = document.createElement("span");
      label.textContent = item.name;

      li.appendChild(checkbox);
      li.appendChild(label);
      list.appendChild(li);
    });
  }
}

function clearChecked() {
  // remet à zéro les checkboxes des ingrédients (DOM only, pas de persistance)
  document.querySelectorAll("#shopping-list .shopping-card").forEach(li => {
    const cb = li.querySelector("input[type=checkbox]");
    if (cb) cb.checked = false;
    li.classList.remove("checked");
  });
}

// ─────────────────────────────────────────
// VIEWER
// ─────────────────────────────────────────
function openViewer(i) {
  const r = recipes[i];
  document.getElementById("viewer-title").textContent = r.name;

  const container = document.getElementById("viewer-body");
  container.innerHTML = "";

  const meta = document.createElement("p");
  meta.style.cssText = "color:var(--muted); font-size:13px;";
  const parts = [];
  if (r.time)       parts.push(`⏱️ ${r.time} min`);
  if (r.difficulty) parts.push(`• ${r.difficulty}`);
  if (r.servings)   parts.push(`• ${r.servings} personnes`);
  meta.textContent = parts.join(" ");
  container.appendChild(meta);

  const ingTitle = document.createElement("h3");
  ingTitle.textContent = "🧂 Ingrédients";
  const ingList = document.createElement("ul");
  ingList.style.paddingLeft = "18px";
  (r.ingredients || []).forEach(ing => {
    const li = document.createElement("li");
    li.textContent = `${ing.qty} ${ing.unit} — ${ing.name}`;
    li.style.marginBottom = "6px";
    ingList.appendChild(li);
  });

  const stepsTitle = document.createElement("h3");
  stepsTitle.textContent = "👨‍🍳 Préparation";
  const stepsList = document.createElement("ol");
  stepsList.style.paddingLeft = "18px";
  (r.steps || []).forEach(step => {
    const li = document.createElement("li");
    li.textContent = step;
    li.style.cssText = "margin-bottom:8px; line-height:1.5;";
    stepsList.appendChild(li);
  });

  container.appendChild(ingTitle);
  container.appendChild(ingList);
  container.appendChild(stepsTitle);
  container.appendChild(stepsList);

  document.getElementById("viewer").classList.remove("hidden");
}

function closeViewer() {
  document.getElementById("viewer").classList.add("hidden");
}

// ─────────────────────────────────────────
// EDITOR
// ─────────────────────────────────────────
function openEditor(index = null) {
  editingIndex = index;

  document.getElementById("edit-name").value       = "";
  document.getElementById("edit-tags").value       = "";
  document.getElementById("edit-time").value       = "";
  document.getElementById("edit-difficulty").value = "";
  document.getElementById("edit-servings").value   = "";
  document.getElementById("steps").value           = "";
  document.getElementById("ingredients").innerHTML = "";

  if (editingIndex !== null) {
    const r = recipes[editingIndex];
    document.getElementById("edit-name").value       = r.name || "";
    document.getElementById("edit-tags").value       = (r.tags || []).join(", ");
    document.getElementById("edit-time").value       = r.time || "";
    document.getElementById("edit-difficulty").value = r.difficulty || "";
    document.getElementById("edit-servings").value   = r.servings || "";
    document.getElementById("steps").value           = (r.steps || []).join("\n");
    (r.ingredients || []).forEach(ing => addIngredient(ing));
  } else {
    addIngredient();
  }

  document.getElementById("editor").classList.remove("hidden");
}

function closeEditor() {
  document.getElementById("editor").classList.add("hidden");
  editingIndex = null;
}

function addIngredient(ing = {}) {
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.style.cssText = "display:flex; gap:6px; margin-bottom:8px; align-items:center;";

  const nameInput = document.createElement("input");
  nameInput.placeholder = "Ingrédient";
  nameInput.value = ing.name || "";
  nameInput.style.flex = "2";

  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.placeholder = "Qté";
  qtyInput.value = ing.qty || "";
  qtyInput.style.flex = "1";

  const unitInput = document.createElement("input");
  unitInput.placeholder = "Unité";
  unitInput.value = ing.unit || "";
  unitInput.style.flex = "1";

  const removeBtn = document.createElement("button");
  removeBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">close</span>`;
  removeBtn.style.cssText = "background:#3d1f1f; border:none; border-radius:8px; color:#f87171; cursor:pointer; padding:6px; display:flex; align-items:center;";
  removeBtn.onclick = () => row.remove();

  row.appendChild(nameInput);
  row.appendChild(qtyInput);
  row.appendChild(unitInput);
  row.appendChild(removeBtn);

  document.getElementById("ingredients").appendChild(row);
}

async function saveRecipe() {
  const name = document.getElementById("edit-name").value.trim();
  if (!name) return showToast("❌ Le nom est requis.");

  const tags = document.getElementById("edit-tags").value
    .split(",").map(t => t.trim()).filter(Boolean);
  const steps = document.getElementById("steps").value
    .split("\n").map(s => s.trim()).filter(Boolean);
  const time       = parseInt(document.getElementById("edit-time").value)    || null;
  const difficulty = document.getElementById("edit-difficulty").value         || null;
  const servings   = parseInt(document.getElementById("edit-servings").value) || null;

  const ingredients = [];
  document.querySelectorAll(".ingredient-row").forEach(row => {
    const inputs = row.querySelectorAll("input");
    const ingName = inputs[0]?.value.trim();
    const qty     = inputs[1]?.value.trim();
    const unit    = inputs[2]?.value.trim();
    if (ingName) ingredients.push({ name: ingName, qty, unit });
  });

  const recipe = { name, tags, time, difficulty, servings, steps, ingredients };

  if (editingIndex !== null) {
    recipe._supaId = recipes[editingIndex]._supaId;
    await saveRecipeToSupabase(recipe);
    recipes[editingIndex] = recipe;

    const si = selectedRecipes.findIndex(r => r._index === editingIndex);
    if (si !== -1) {
      const mult = selectedRecipes[si].multiplier;
      selectedRecipes[si] = { ...recipe, _index: editingIndex, multiplier: mult };
      await saveSelected();
    }
    showToast("✅ Recette modifiée !");
  } else {
    await saveRecipeToSupabase(recipe);
    recipes.push(recipe);
    showToast("✅ Recette ajoutée !");
  }

  renderFilterButtons();
  renderRecipes();
  renderSelected();
  renderShopping();
  closeEditor();
}

// ─────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────
function showTab(tab) {
  const views = ["recipes-list", "selected-view", "shopping-view", "extras-view", "menu-view", "scanner-view"];
  const extras2 = ["search-container", "filters"];

  views.forEach(id => document.getElementById(id)?.classList.add("hidden"));
  document.querySelector(".search-container")?.classList.add("hidden");
  document.querySelector(".filters")?.classList.add("hidden");
  document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.remove("active-tab"));

  const map = {
    recipes:  ["recipes-list", "search-container-special", "nav-recipes"],
    selected: ["selected-view", null, "nav-selected"],
    shopping: ["shopping-view", null, "nav-shopping"],
    extras:   ["extras-view",   null, "nav-extras"],
    menu:     ["menu-view",     null, "nav-menu"],
    scanner:  ["scanner-view",  null, "nav-scanner"],
  };

  if (tab === "recipes") {
    document.getElementById("recipes-list")?.classList.remove("hidden");
    document.querySelector(".search-container")?.classList.remove("hidden");
    document.querySelector(".filters")?.classList.remove("hidden");
    document.getElementById("nav-recipes")?.classList.add("active-tab");
  } else if (tab === "selected") {
    document.getElementById("selected-view")?.classList.remove("hidden");
    document.getElementById("nav-selected")?.classList.add("active-tab");
  } else if (tab === "shopping") {
    document.getElementById("shopping-view")?.classList.remove("hidden");
    document.getElementById("nav-shopping")?.classList.add("active-tab");
  } else if (tab === "extras") {
    document.getElementById("extras-view")?.classList.remove("hidden");
    document.getElementById("nav-extras")?.classList.add("active-tab");
  } else if (tab === "menu") {
    document.getElementById("menu-view")?.classList.remove("hidden");
    document.getElementById("nav-menu")?.classList.add("active-tab");
    if (!weekMenu.some(Boolean)) generateMenu();
  } else if (tab === "scanner") {
    document.getElementById("scanner-view")?.classList.remove("hidden");
    document.getElementById("nav-scanner")?.classList.add("active-tab");
  }
}

// ─────────────────────────────────────────
// EXTRAS
// ─────────────────────────────────────────
function saveExtras() {
  localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras));
}

function renderExtras() {
  const container = document.getElementById("extras-list");
  if (!container) return;
  container.innerHTML = "";

  let hasItems = false;

  EXTRA_CATEGORIES.forEach(cat => {
    const items = extras.filter(e => e.category === cat);
    if (!items.length) return;
    hasItems = true;

    const title = document.createElement("li");
    title.style.cssText = "list-style:none; font-weight:bold; margin-top:16px; margin-bottom:4px; color:var(--muted); font-size:13px;";
    title.textContent = cat;
    container.appendChild(title);

    items.forEach(item => {
      const realIndex = extras.indexOf(item);
      const li = document.createElement("li");
      li.className = "shopping-card";
      if (item.checked) li.classList.add("checked");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.checked || false;
      checkbox.onchange = () => {
        extras[realIndex].checked = checkbox.checked;
        saveExtras();
        renderExtras();
        renderShopping();
      };

      const label = document.createElement("span");
      label.textContent = item.name;

      const deleteBtn = document.createElement("button");
      deleteBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">close</span>`;
      deleteBtn.style.cssText = "margin-left:auto; background:var(--btn-remove-bg); border:none; border-radius:8px; color:var(--btn-remove-color); cursor:pointer; padding:4px; display:flex; align-items:center;";
      deleteBtn.onclick = () => {
        extras.splice(realIndex, 1);
        saveExtras();
        renderExtras();
        renderShopping();
      };

      li.appendChild(checkbox);
      li.appendChild(label);
      li.appendChild(deleteBtn);
      container.appendChild(li);
    });
  });

  if (!hasItems) {
    container.innerHTML = `<p style="color:var(--muted); text-align:center; margin-top:32px;">Aucun article ajouté</p>`;
  }
}

function addExtra() {
  const nameInput = document.getElementById("extra-name");
  const catSelect = document.getElementById("extra-category");
  const name = nameInput.value.trim();
  if (!name) return showToast("❌ Nom requis.");

  extras.push({ name, category: catSelect.value, checked: false });
  saveExtras();
  nameInput.value = "";
  renderExtras();
  renderShopping();
}

// ─────────────────────────────────────────
// MENU
// ─────────────────────────────────────────
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function pickRecipe(excludeIndex, previousTags, previousDifficulty) {
  if (!recipes.length) return null;
  let pool = recipes.map((r, i) => ({ ...r, _index: i })).filter(r => r._index !== excludeIndex);
  if (!pool.length) return recipes[0] ? { ...recipes[0], _index: 0 } : null;

  let candidates = pool.filter(r =>
    !(r.tags || []).some(t => (previousTags || []).includes(t)) &&
    r.difficulty !== previousDifficulty
  );
  if (!candidates.length) candidates = pool.filter(r => !(r.tags || []).some(t => (previousTags || []).includes(t)));
  if (!candidates.length) candidates = pool.filter(r => r.difficulty !== previousDifficulty);
  if (!candidates.length) candidates = pool;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function generateMenu() {
  if (!recipes.length) { showToast("❌ Aucune recette disponible."); return; }
  weekMenu = [];
  let prevTags = null, prevDifficulty = null, prevIndex = null;

  for (let i = 0; i < 7; i++) {
    const picked = pickRecipe(prevIndex, prevTags, prevDifficulty);
    weekMenu.push(picked);
    prevTags       = picked?.tags || null;
    prevDifficulty = picked?.difficulty || null;
    prevIndex      = picked?._index ?? null;
  }
  renderMenu();
}

function rerollDay(i) {
  if (!recipes.length) return;
  const prev = weekMenu[i - 1];
  weekMenu[i] = pickRecipe(prev?._index ?? null, prev?.tags ?? null, prev?.difficulty ?? null);
  renderMenu();
}

function renderMenu() {
  const container = document.getElementById("menu-days");
  if (!container) return;
  container.innerHTML = "";

  if (!recipes.length) {
    container.innerHTML = `<p style="color:var(--muted); text-align:center; margin-top:32px;">Aucune recette disponible</p>`;
    return;
  }

  DAYS.forEach((day, i) => {
    const r = weekMenu[i];
    const card = document.createElement("div");
    card.style.cssText = "background:var(--card-bg); border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:12px; border:1px solid var(--border); margin-bottom:8px;";

    const dayLabel = document.createElement("span");
    dayLabel.style.cssText = "font-weight:600; min-width:72px; color:var(--accent);";
    dayLabel.textContent = day;

    const info = document.createElement("div");
    info.style.flex = "1";

    const name = document.createElement("div");
    name.style.cssText = "font-size:15px; font-weight:500;";
    name.textContent = r ? r.name : "—";

    const meta = document.createElement("div");
    meta.style.cssText = "font-size:12px; color:var(--muted); margin-top:2px;";
    const parts = [];
    if (r?.time)       parts.push(`⏱️ ${r.time} min`);
    if (r?.difficulty) parts.push(r.difficulty);
    if (r?.tags?.length) parts.push(r.tags.slice(0, 2).join(", "));
    meta.textContent = parts.join(" • ");

    info.appendChild(name);
    info.appendChild(meta);

    const rerollBtn = document.createElement("button");
    rerollBtn.title = "Regénérer ce jour";
    rerollBtn.style.cssText = "background:var(--btn-secondary); border:none; border-radius:8px; padding:6px; cursor:pointer; color:var(--text); display:flex; align-items:center;";
    rerollBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px;">refresh</span>`;
    rerollBtn.onclick = () => rerollDay(i);

    card.appendChild(dayLabel);
    card.appendChild(info);
    card.appendChild(rerollBtn);
    container.appendChild(card);
  });
}

async function sendMenuToSelection() {
  const valid = weekMenu.filter(Boolean);
  if (!valid.length) { showToast("❌ Génère d'abord un menu !"); return; }

  let added = 0;
  valid.forEach(r => {
    const alreadyIn = selectedRecipes.some(s => s._index === r._index);
    if (!alreadyIn) {
      selectedRecipes.push({ ...r, multiplier: 1 });
      added++;
    }
  });

  await saveSelected();
  renderSelected();
  renderShopping();
  showToast(`✅ ${added} recette(s) ajoutée(s) à la sélection !`);
}

// ─────────────────────────────────────────
// SCANNER
// ─────────────────────────────────────────
function triggerScanInput() {
  document.getElementById("scan-input").click();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("scan-input").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    scanFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById("scanner-img").src = ev.target.result;
      document.getElementById("scanner-preview").style.display   = "block";
      document.getElementById("scanner-dropzone").style.display  = "none";
      document.getElementById("btn-scan-analyze").style.display  = "block";
      document.getElementById("scanner-result").style.display    = "none";
      document.getElementById("scanner-loader").style.display    = "none";
    };
    reader.readAsDataURL(file);
  });
});

async function launchScan() {
  if (!scanFile) return;
  scanAborted = false;
  document.getElementById("btn-scan-analyze").style.display = "none";
  document.getElementById("scanner-loader").style.display   = "block";
  document.getElementById("scanner-result").style.display   = "none";

  try {
    const base64 = await toBase64(scanFile);
    const recipe = await scanRecipeFromPhoto(base64);
    if (scanAborted) return;
    scannedRecipe = recipe;

    document.getElementById("scanner-loader").style.display = "none";
    document.getElementById("scanner-result").style.display = "block";

    const ings  = (recipe.ingredients || []).map(i => `• ${i.quantity || ""} ${i.unit || ""} ${i.name}`).join("<br>");
    const steps = (recipe.steps || []).map((s, i) => `${i + 1}. ${s}`).join("<br>");

    document.getElementById("scanner-result-card").innerHTML = `
      <b style="font-size:17px;">🍽️ ${recipe.name || "Recette scannée"}</b><br><br>
      ${recipe.time ? `⏱️ <b>${recipe.time} min</b>&nbsp;&nbsp;` : ""}
      ${recipe.difficulty ? `👨‍🍳 <b>${recipe.difficulty}</b>` : ""}<br><br>
      <b>Ingrédients :</b><br>${ings || "—"}<br><br>
      <b>Étapes :</b><br>${steps || "—"}
    `;
  } catch (err) {
    if (scanAborted) return;
    document.getElementById("scanner-loader").style.display   = "none";
    document.getElementById("btn-scan-analyze").style.display = "block";
    showToast("❌ Erreur lors de l'analyse. Réessaie.");
    console.error(err);
  }
}

function cancelScan() {
  scanAborted = true;
  document.getElementById("scanner-loader").style.display   = "none";
  document.getElementById("btn-scan-analyze").style.display = "block";
}

function resetScanner() {
  scanFile = null;
  scannedRecipe = null;
  scanAborted = false;
  document.getElementById("scan-input").value                = "";
  document.getElementById("scanner-dropzone").style.display  = "block";
  document.getElementById("scanner-preview").style.display   = "none";
  document.getElementById("btn-scan-analyze").style.display  = "none";
  document.getElementById("scanner-loader").style.display    = "none";
  document.getElementById("scanner-result").style.display    = "none";
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveScanAsRecipe() {
  if (!scannedRecipe) return;
  const recipe = {
    name:        scannedRecipe.name || "Recette scannée",
    tags:        scannedRecipe.tags || [],
    time:        scannedRecipe.time || null,
    difficulty:  scannedRecipe.difficulty || "",
    servings:    scannedRecipe.servings || null,
    ingredients: (scannedRecipe.ingredients || []).map(i => ({
      name: i.name, qty: i.quantity || i.qty || "", unit: i.unit || ""
    })),
    steps: scannedRecipe.steps || [],
  };

  await saveRecipeToSupabase(recipe);
  recipes.push(recipe);
  renderFilterButtons();
  renderRecipes();
  showToast("✅ Recette enregistrée !");
  resetScanner();
  showTab("recipes");
}

