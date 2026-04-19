// ════════════════════════════════════════════════════════
//  HAN KAFEM — Ultra Luxury QR Menu Script
//  Google Sheets → Luxury Card Layout
//  v4: badge · lightbox · search · scroll-to-top
// ════════════════════════════════════════════════════════

const SHEET_ID   = "106UdRlB66eCxZAdrxtyKCynb3UTrvoEpObLvRYjzlrI";
const SHEET_NAME = "Sayfa1";
const DATA_URL   = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(SHEET_NAME)}`;

const CACHE_KEY        = "hankafem_lux_v4";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6h

// Tüm veri burada tutulur (arama için)
let _allItems = [];

// ─── INIT ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initScrollTop();
  initTouchCards();
  initLightbox();
  initSearch();

  const cached = readCache();
  if (cached?.items?.length) {
    _allItems = cached.items;
    renderFull(cached.items);
  } else {
    showLoading();
  }

  loadFresh().catch(err => {
    console.error("[HanKafem]", err);
    if (!readCache()?.items?.length) {
      showError("Menü şu an yüklenemiyor. Lütfen birkaç saniye sonra tekrar deneyin.");
    }
  });
});

// ─── DATA LAYER ──────────────────────────────────────────
async function loadFresh() {
  const cached = readCache();
  if (!cached?.items?.length) showLoading();

  const items = await fetchWithRetry(3);
  const hash  = hashStr(JSON.stringify(items));

  if (cached?.hash === hash && cached?.items?.length) return;

  _allItems = items;
  renderFull(items);
  writeCache({ items, hash, ts: Date.now() });
}

async function fetchWithRetry(n) {
  let lastErr;
  for (let i = 0; i < n; i++) {
    try { return await fetchItems(); }
    catch (e) { lastErr = e; await sleep(400 * (i + 1)); }
  }
  throw lastErr;
}

async function fetchItems() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  let res;
  try {
    res = await fetch(DATA_URL, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "Accept": "application/json" }
    });
  } finally { clearTimeout(timer); }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const rows = await res.json();

  return rows
    .map(r => ({
      category: str(r.category),
      name:     str(r.name),
      price:    str(r.price),
      desc:     str(r.desc),
      image:    str(r.image),
      badge:    str(r.badge),           // ← YENİ: Yeni / Çok Satan vb.
      active:   str(r.active).toLowerCase() === "true",
      order:    Number(r.order) || 9999
    }))
    .filter(x => x.active && x.category && x.name && x.price)
    .sort((a, b) => a.order - b.order);
}

// ─── RENDER ──────────────────────────────────────────────
function renderFull(items) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  if (!items?.length) {
    root.innerHTML = `<div class="lux-error">Menüde henüz ürün bulunamadı.</div>`;
    buildCategoryNav([]);
    return;
  }

  const catOrder = [];
  const byCat    = {};
  items.forEach(it => {
    if (!byCat[it.category]) { byCat[it.category] = []; catOrder.push(it.category); }
    byCat[it.category].push(it);
  });

  buildCategoryNav(catOrder);

  root.innerHTML = catOrder.map((cat, idx) => `
    <section
      class="menu-section"
      id="cat-${slugify(cat)}"
      style="animation-delay:${idx * 0.08}s"
    >
      <div class="section-header">
        <h2 class="section-title">${esc(cat)}</h2>
        <div class="section-line"></div>
        <span class="section-count">${byCat[cat].length} ÜRÜN</span>
      </div>
      <div class="cards-grid">
        ${byCat[cat].map(it => cardHTML(it)).join("")}
      </div>
    </section>
  `).join("");

  // Lazy-load images
  root.querySelectorAll("img[data-src]").forEach(img => lazyLoad(img));
}

function cardHTML(it) {
  const imgInner = it.image
    ? `<img data-src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy">`
    : `<div class="prod-img-placeholder">☕</div>`;

  const badgeHTML = it.badge
    ? `<div class="prod-badge">${esc(it.badge)}</div>`
    : "";

  return `
    <div class="prod-card" data-item='${jsonAttr(it)}'>
      <div class="prod-img-wrap">
        ${badgeHTML}
        ${imgInner}
        <div class="prod-img-gradient"></div>
      </div>
      <div class="prod-body">
        <h3 class="prod-name">${esc(it.name)}</h3>
        ${it.desc ? `<p class="prod-desc">${esc(it.desc)}</p>` : ""}
        <div class="prod-footer">
          <span class="prod-price">
            ${esc(it.price)}<span class="prod-price-suffix">₺</span>
          </span>
          <div class="prod-dot"></div>
        </div>
      </div>
    </div>
  `;
}

// ─── CATEGORY TABS ───────────────────────────────────────
function buildCategoryNav(cats) {
  const nav = document.getElementById("cat-nav-inner");
  if (!nav) return;

  nav.innerHTML = cats.map((cat, i) => `
    <button
      class="cat-tab${i === 0 ? " active" : ""}"
      data-cat="${slugify(cat)}"
      type="button"
    >${esc(cat)}</button>
  `).join("");

  nav.addEventListener("click", e => {
    const btn = e.target.closest(".cat-tab");
    if (!btn) return;
    nav.querySelectorAll(".cat-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    scrollToSection(btn.dataset.cat);
  }, { passive: true });

  setupScrollSpy(cats);
}

function scrollToSection(slug) {
  const target = document.getElementById(`cat-${slug}`);
  if (!target) return;
  const headerH = (document.getElementById("site-header")?.offsetHeight || 61)
                + (document.getElementById("search-bar-wrap")?.offsetHeight || 48)
                + (document.getElementById("cat-nav")?.offsetHeight || 44)
                + 12;
  const y = target.getBoundingClientRect().top + window.scrollY - headerH;
  window.scrollTo({ top: y, behavior: "smooth" });
}

function setupScrollSpy(cats) {
  if (!cats.length) return;
  const headerOffset = 160;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id  = entry.target.id.replace("cat-", "");
        const nav = document.getElementById("cat-nav-inner");
        if (!nav) return;
        nav.querySelectorAll(".cat-tab").forEach(b => {
          b.classList.toggle("active", b.dataset.cat === id);
        });
        const activeTab = nav.querySelector(".cat-tab.active");
        if (activeTab) {
          activeTab.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
        }
      }
    });
  }, { rootMargin: `-${headerOffset}px 0px -60% 0px`, threshold: 0 });

  cats.forEach(cat => {
    const el = document.getElementById(`cat-${slugify(cat)}`);
    if (el) observer.observe(el);
  });
}

// ─── SEARCH ──────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clear.hidden = !q;
    filterMenu(q);
  });

  clear.addEventListener("click", () => {
    input.value = "";
    clear.hidden = true;
    filterMenu("");
    input.focus();
  });
}

function filterMenu(query) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  // Arama yoksa tam render
  if (!query) {
    renderFull(_allItems);
    document.getElementById("cat-nav").style.display = "";
    return;
  }

  // Kategori tabını gizle (arama modunda karışmasın)
  document.getElementById("cat-nav").style.display = "none";

  const q = normalize(query);

  const matched = _allItems.filter(it =>
    normalize(it.name).includes(q) ||
    normalize(it.category).includes(q) ||
    normalize(it.desc).includes(q)
  );

  if (!matched.length) {
    root.innerHTML = `
      <div class="search-no-result">
        "<strong>${esc(query)}</strong>" için sonuç bulunamadı.
      </div>`;
    return;
  }

  // Sonuçları tek bir "Arama Sonuçları" section'ı olarak göster
  root.innerHTML = `
    <section class="menu-section" style="animation-delay:0s">
      <div class="section-header">
        <h2 class="section-title">Arama Sonuçları</h2>
        <div class="section-line"></div>
        <span class="section-count">${matched.length} ÜRÜN</span>
      </div>
      <div class="cards-grid">
        ${matched.map(it => cardHTML(it)).join("")}
      </div>
    </section>`;

  root.querySelectorAll("img[data-src]").forEach(img => lazyLoad(img));
}

// ─── LIGHTBOX ────────────────────────────────────────────
function initLightbox() {
  const lb       = document.getElementById("lightbox");
  const backdrop = document.getElementById("lightbox-backdrop");
  const closeBtn = document.getElementById("lightbox-close");

  if (!lb) return;

  // Kart tıklaması — event delegation (dinamik DOM ile uyumlu)
  document.getElementById("menu-root").addEventListener("click", e => {
    const card = e.target.closest(".prod-card");
    if (!card) return;
    try {
      const item = JSON.parse(card.dataset.item || "{}");
      openLightbox(item);
    } catch { /* parse error */ }
  });

  backdrop.addEventListener("click", closeLightbox);
  closeBtn.addEventListener("click", closeLightbox);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !lb.hidden) closeLightbox();
  });
}

function openLightbox(item) {
  const lb = document.getElementById("lightbox");

  // Fotoğraf
  const imgWrap = document.getElementById("lightbox-img-wrap");
  if (item.image) {
    imgWrap.innerHTML = `
      <img src="${esc(item.image)}" alt="${esc(item.name)}">
      <div class="lightbox-img-gradient"></div>`;
    const img = imgWrap.querySelector("img");
    img.onload  = () => img.classList.add("loaded");
    img.onerror = () => {
      imgWrap.innerHTML = `<div class="lightbox-img-placeholder">☕</div>`;
    };
  } else {
    imgWrap.innerHTML = `<div class="lightbox-img-placeholder">☕</div>`;
  }

  // Badge
  const badgeLine = document.getElementById("lightbox-badge-line");
  badgeLine.innerHTML = item.badge
    ? `<span class="lightbox-badge">${esc(item.badge)}</span>`
    : "";

  document.getElementById("lightbox-name").textContent  = item.name;
  document.getElementById("lightbox-desc").textContent  = item.desc;
  document.getElementById("lightbox-price").textContent = item.price;

  lb.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.hidden = true;
  document.body.style.overflow = "";
}

// ─── SCROLL TO TOP ───────────────────────────────────────
function initScrollTop() {
  const btn = document.getElementById("scroll-top-btn");
  if (!btn) return;

  window.addEventListener("scroll", () => {
    btn.classList.toggle("visible", window.scrollY > 400);
    btn.hidden = false; // hidden attribute'u kaldır, CSS ile göster/gizle
  }, { passive: true });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ─── LOADING / ERROR ─────────────────────────────────────
function showLoading() {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `
    <div class="lux-loading" aria-live="polite">
      <div class="lux-spinner"></div>
      <p>Menü hazırlanıyor…</p>
    </div>`;
}

function showError(msg) {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `
    <div class="lux-error">
      ${esc(msg)}
      <div class="lux-error-sub">Sayfayı yenileyip tekrar deneyin.</div>
    </div>`;
}

// ─── TOUCH CARDS (mobile gold glow) ──────────────────────
function initTouchCards() {
  document.addEventListener("touchstart", e => {
    const card = e.target.closest(".prod-card");
    if (!card) return;
    card.classList.add("touched");
  }, { passive: true });

  document.addEventListener("touchend", () => {
    document.querySelectorAll(".prod-card.touched").forEach(c => {
      setTimeout(() => c.classList.remove("touched"), 400);
    });
  }, { passive: true });
}

// ─── LAZY IMAGE LOADER ───────────────────────────────────
function lazyLoad(img) {
  if (!img.dataset.src) return;
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { loadImg(img); obs.unobserve(img); }
      });
    }, { rootMargin: "200px" });
    obs.observe(img);
  } else {
    loadImg(img);
  }
}

function loadImg(img) {
  const src = img.dataset.src;
  if (!src) return;
  img.src = src;
  img.onload  = () => img.classList.add("loaded");
  img.onerror = () => {
    img.closest(".prod-img-wrap")?.insertAdjacentHTML(
      "afterbegin",
      `<div class="prod-img-placeholder">☕</div>`
    );
    img.remove();
  };
}

// ─── CACHE ───────────────────────────────────────────────
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.items || !p?.ts) return null;
    if (Date.now() - p.ts > CACHE_MAX_AGE_MS) return null;
    return p;
  } catch { return null; }
}

function writeCache(payload) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); }
  catch { /* storage full */ }
}

// ─── UTILS ───────────────────────────────────────────────
function str(v) { return String(v ?? "").trim(); }

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/ş/g,"s").replace(/ğ/g,"g").replace(/ü/g,"u")
    .replace(/ö/g,"o").replace(/ç/g,"c").replace(/ı/g,"i")
    .replace(/[^a-z0-9]/g,"-");
}

function normalize(s) {
  return String(s ?? "").toLowerCase()
    .replace(/ş/g,"s").replace(/ğ/g,"g").replace(/ü/g,"u")
    .replace(/ö/g,"o").replace(/ç/g,"c").replace(/ı/g,"i").replace(/İ/g,"i");
}

/* JSON'u HTML attribute'una güvenli yazmak için */
function jsonAttr(obj) {
  return JSON.stringify(obj).replace(/'/g, "&#039;");
}

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return String(h >>> 0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
