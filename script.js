// ======================
// Google Sheet Ayarları
// ======================
const SHEET_ID = "106UdRlB66eCxZAdrxtyKCynb3UTrvoEpObLvRYjzlrI";
const SHEET_NAME = "Sayfa1"; // sekme adı farklıysa değiştir

const DATA_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(SHEET_NAME)}`;

// Cache (menü ilk açılışta anında görünsün diye)
const CACHE_KEY = "han_kafem_menu_cache_v1";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6 saat

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("menu-root");
  if (!root) return;

  // 1) Önce cache varsa hemen bas (butonlar gecikmesin)
  const cached = readCache();
  if (cached?.items?.length) {
    renderMenu(cached.items);
    // Cache'ten gelen menüde default ilk kategoriyi aç
    openFirstCategory();
  } else {
    showLoading();
  }

  // 2) Ardından güncel veriyi çek (başarısız olursa ekranda cache kalır)
  loadAndRenderFresh().catch(err => {
    console.error(err);
    if (!cached?.items?.length) showError("Menü yüklenemedi. Lütfen tekrar deneyin.");
  });

  // 3) Accordion (event delegation - re-render olunca çift tıklama olmaz)
  setupAccordionDelegated();
});

async function loadAndRenderFresh() {
  const root = document.getElementById("menu-root");
  if (!root) return;

  // Cache yoksa loading göster
  if (!readCache()?.items?.length) showLoading();

  const items = await fetchMenuItemsWithRetry(3);

  // Aynı veri geldiyse yeniden render etme (flicker / git-gel olmasın)
  const newHash = hashString(JSON.stringify(items));
  const cached = readCache();
  if (cached?.hash === newHash && cached?.items?.length) {
    hideLoading();
    return;
  }

  renderMenu(items);
  openFirstCategory();
  writeCache({ items, hash: newHash, ts: Date.now() });
  hideLoading();
}

async function fetchMenuItemsWithRetry(maxRetries) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchMenuItems();
    } catch (err) {
      lastErr = err;
      // küçük bir backoff
      await sleep(350 * (i + 1));
    }
  }
  throw lastErr;
}

async function fetchMenuItems() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8sn timeout

  let res;
  try {
    res = await fetch(DATA_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error("Sheet okunamadı");

  const rows = await res.json();

  const items = rows
    .map(r => ({
      category: String(r.category || "").trim(),
      name: String(r.name || "").trim(),
      price: String(r.price || "").trim(),
      desc: String(r.desc || "").trim(),
      active: String(r.active || "").trim().toLowerCase() === "true",
      order: Number(r.order || 9999) || 9999
    }))
    .filter(x => x.active && x.category && x.name && x.price)
    .sort((a, b) => a.order - b.order);

  return items;
}

function renderMenu(items) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  if (!items?.length) {
    root.innerHTML = `
      <div class="menu-state">
        Menü boş görünüyor. Google Sheet'te <b>active=true</b> olan satır olduğundan emin olun.
      </div>
    `;
    return;
  }

  // Kategoriye göre grupla (liste sırası order'a göre)
  const byCat = items.reduce((acc, it) => {
    (acc[it.category] ||= []).push(it);
    return acc;
  }, {});

  // Kategori sırasını Sheet'te ilk göründüğü sıraya göre koru
  const categories = [];
  items.forEach(it => {
    if (!categories.includes(it.category)) categories.push(it.category);
  });

  root.innerHTML = categories.map(cat => `
    <section class="category" data-category="${escapeHtml(cat)}">
      <h2 class="category-title">${escapeHtml(cat)}</h2>
      <div class="menu-items" role="region" aria-label="${escapeHtml(cat)} menüsü">
        ${byCat[cat].map(it => `
          <div class="menu-item">
            <div class="menu-item-left">
              <h3>${escapeHtml(it.name)}</h3>
              ${it.desc ? `<div class="menu-desc">${escapeHtml(it.desc)}</div>` : ""}
            </div>
            <span class="price">${escapeHtml(it.price)}₺</span>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function setupAccordionDelegated() {
  const root = document.getElementById("menu-root");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const header = e.target.closest(".category-title");
    if (!header) return;

    const categoryEl = header.closest(".category");
    if (!categoryEl) return;

    // Scroll "git-gel" (zıplama) olmasın diye: header konumunu sabitle
    const topBefore = header.getBoundingClientRect().top;

    // Diğerlerini kapat
    root.querySelectorAll(".category.open").forEach(el => {
      if (el !== categoryEl) el.classList.remove("open");
    });

    // Tıkalanı toggle et
    categoryEl.classList.toggle("open");

    requestAnimationFrame(() => {
      const topAfter = header.getBoundingClientRect().top;
      window.scrollBy(0, topAfter - topBefore);
    });
  }, { passive: true });
}

function openFirstCategory() {
  const root = document.getElementById("menu-root");
  if (!root) return;

  const first = root.querySelector(".category");
  if (!first) return;

  // Eğer hiç açık yoksa ilkini aç
  if (!root.querySelector(".category.open")) {
    first.classList.add("open");
  }
}

function showLoading() {
  const root = document.getElementById("menu-root");
  if (!root) return;

  root.innerHTML = `
    <div class="menu-loading" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <div>Menü yükleniyor…</div>
      <div class="menu-loading-sub">Bağlantı yavaşsa birkaç saniye sürebilir.</div>
    </div>
  `;
}

function hideLoading() {
  // Loading HTML zaten renderMenu ile değişiyor. Burada sadece güvenlik.
}

function showError(msg) {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `
    <div class="menu-state menu-error">
      ${escapeHtml(msg)}
      <div class="menu-error-sub">Sayfayı yenileyip tekrar deneyin.</div>
    </div>
  `;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.items || !parsed?.ts) return null;

    // Çok eski cache'i kullanma
    if (Date.now() - parsed.ts > CACHE_MAX_AGE_MS) return null;

    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // storage dolu olabilir, sorun değil
  }
}

function hashString(str) {
  // Basit ve hızlı hash (djb2)
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return String(h >>> 0);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
