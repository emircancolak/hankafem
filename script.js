// ======================
// Google Sheet Ayarları
// ======================
const SHEET_ID = "106UdRlB66eCxZAdrxtyKCynb3UTrvoEpObLvRYjzlrI";
const SHEET_NAME = "Sayfa1"; // sekme adı farklıysa değiştir

const DATA_URL = `https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(SHEET_NAME)}`;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const items = await fetchMenuItems();
    renderMenu(items);
    setupAccordion();
  } catch (err) {
    console.error(err);
    showError("Menü yüklenemedi. Lütfen tekrar deneyin.");
  }
});

async function fetchMenuItems() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Sheet okunamadı");

  const rows = await res.json();

  return rows
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

}

function renderMenu(items) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  // Kategoriye göre grupla (liste sırası order'a göre)
  const byCat = items.reduce((acc, it) => {
    (acc[it.category] ||= []).push(it);
    return acc;
  }, {});

  // ✅ Kategori sırasını Sheet'te ilk göründüğü sıraya göre koru
  const categories = [];
  items.forEach(it => {
    if (!categories.includes(it.category)) categories.push(it.category);
  });

  root.innerHTML = categories.map(cat => `
    <section class="category">
      <h2>${escapeHtml(cat)}</h2>
      <div class="menu-items">
        ${byCat[cat].map(it => `
          <div class="menu-item">
            <div>
              <h3>${escapeHtml(it.name)}</h3>
              ${it.desc ? `<div style="opacity:.85;font-size:13px;margin-top:6px">${escapeHtml(it.desc)}</div>` : ""}
            </div>
            <span class="price">${escapeHtml(it.price)}₺</span>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");
}



function setupAccordion() {
  const headers = document.querySelectorAll(".category h2");

  headers.forEach(header => {
    const items = header.closest(".category").querySelector(".menu-items");
    items.style.display = "none";

    header.addEventListener("click", () => {
      headers.forEach(h => {
        if (h !== header) {
          h.classList.remove("active");
          h.closest(".category").querySelector(".menu-items").style.display = "none";
        }
      });

      if (items.style.display === "block") {
        items.style.display = "none";
        header.classList.remove("active");
      } else {
        items.style.display = "block";
        header.classList.add("active");
      }
    });
  });
}

function showError(msg) {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `
    <div style="padding:16px;border:1px solid rgba(212,175,55,.25);border-radius:12px;background:rgba(0,0,0,.35);text-align:center">
      ${escapeHtml(msg)}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
