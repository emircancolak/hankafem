// ════════════════════════════════════════════════════════
//  HAN KAFEM — Müşteri Vitrini (Google Cloud CDN)
//  Firebase SDK Bağımlılığı SIFIR. Maksimum Hız.
// ════════════════════════════════════════════════════════
//
// ⚠️ FIREBASE STORAGE RULES HATIRLATMASI ⚠️
// Bu dosya, Storage'daki public_menus/{kafe_id}.json dosyalarını Firebase
// Auth OLMADAN, doğrudan public bir fetch() isteğiyle okur (CQRS mimarisi —
// bkz. dosya başlığı). Bu nedenle Storage Rules'ta aşağıdaki kuralın
// tanımlı olduğundan MUTLAKA emin olun, aksi halde bu dosya 403 alır ve
// "İşletme Bulunamadı" ekranı gösterir:
//
//   rules_version = '2';
//   service firebase.storage {
//     match /b/{bucket}/o {
//       match /public_menus/{fileName} {
//         allow read: if true;
//         allow write: if false; // yazma işlemi sadece admin panelden (Auth+SDK) yapılır
//       }
//     }
//   }
//
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
//  HARDCODED KAFE UID (Bu özel/tekil müşteri sürümüne özeldir)
// ════════════════════════════════════════════════════════
// Standart (çok kiracılı) app.js sürümünde kafe kimliği URL'deki ?kafe=
// parametresinden okunur. Bu ÖZEL sürümde ise o mantık tamamen kaldırılmış
// olup, kafe kimliği doğrudan aşağıdaki sabitten gelir. Uygulamadaki TÜM
// API çağrıları (Storage fetch, Firestore yorum gönderimi, dinamik
// manifest vb.) bu sabiti kullanır.
//
// ⚠️ YAYINA ALMADAN ÖNCE aşağıdaki değeri bu müşterinin gerçek kafe_id'si
// ile değiştirmeyi UNUTMAYIN.
const HARDCODED_KAFE_ID = "BH2K64eH7pguRNszLQicIQQQvR93";

const STORAGE_BASE = "https://storage.googleapis.com/han-kafem-menu.firebasestorage.app/public_menus";

// ════════════════════════════════════════════════════════
//  CLOUDFLARE CDN / IMAGE PROXY
// ════════════════════════════════════════════════════════
// Ürün/hero/logo görselleri, Firebase Storage'dan doğrudan DEĞİL, önce bu
// CDN'den servis edilir (Cloudflare, kendi origin'i olarak Firebase Storage'ı
// kullanacak şekilde yapılandırılmalıdır — ör. bir "CNAME setup" veya bir
// Cloudflare Worker reverse-proxy). Bu sayede görseller dünya çapında edge'de
// önbelleklenir ve firebasestorage.googleapis.com üzerindeki trafik/egress
// maliyeti düşer.
//
// NOT: Değeri boş bırakırsanız ("") toCdnUrl() hiçbir şeyi değiştirmez ve
// tüm görseller doğrudan Firebase Storage'dan yüklenmeye devam eder — yani
// CDN henüz kurulmamışken bile site KIRILMAZ.
const CDN_BASE_URL = "https://qr-image-proxy.colakemircan268.workers.dev";

/**
 * Bir görsel URL'sini (varsa) CDN üzerinden servis edilecek şekilde yeniden
 * yazar. Sadece Firebase Storage URL'lerine dokunur — blob: URL'leri, harici
 * (3. parti) URL'ler veya zaten CDN'e ait URL'ler olduğu gibi bırakılır.
 *
 * Firebase Storage indirme URL'leri "?alt=media&token=..." gibi bir imza
 * taşıyabildiği için, burada dosya adını çıkarıp yeniden bir yol KURMUYORUZ
 * (bu, token'ı kaybedip görseli kırardı). Bunun yerine origin'i (host) CDN
 * ile değiştirip path + query string'i AYNEN koruyoruz — Cloudflare bu
 * isteği kendi origin'ine (Firebase Storage) proxy'ler ve sonucu cache'ler.
 *
 * @param {string} url
 * @returns {string}
 */
function toCdnUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (!CDN_BASE_URL) return url; // CDN henüz yapılandırılmadı — orijinal URL'i kullan

  try {
    const parsed = new URL(url);
    const isFirebaseStorage =
      parsed.hostname === "firebasestorage.googleapis.com" ||
      parsed.hostname.endsWith(".firebasestorage.app") ||
      (parsed.hostname === "storage.googleapis.com" && parsed.pathname.includes("firebasestorage"));
    if (!isFirebaseStorage) return url; // Firebase Storage değilse dokunma

    return `${CDN_BASE_URL}${parsed.pathname}${parsed.search}`;
  } catch {
    return url; // geçersiz/parse edilemeyen URL — olduğu gibi bırak (img.onerror devreye girer)
  }
}

/**
 * Admin panelinden serbest metin olarak girilen harici linkleri (Instagram
 * linki, Hero slider "Buton Linki" vb.) HER ZAMAN https şemasına yükseltir.
 * Firestore'da eski/hatalı girilmiş bir http:// link kalmış olsa bile,
 * müşteri tarafında <a href> olarak basılırken burada son kez düzeltilir —
 * bu sayede tarayıcı "Güvenli Değil" uyarısı vermez / mixed-content oluşmaz.
 * (scriptAdmin.js içindeki BİREBİR AYNI fonksiyonla senkron tutulmalıdır.)
 */
function ensureHttpsUrl(url) {
  const clean = String(url ?? "").trim();
  if (!clean) return "";
  if (/^(tel|mailto|sms):/i.test(clean)) return clean;
  if (/^https:\/\//i.test(clean) || clean.startsWith("//")) return clean;
  if (/^http:\/\//i.test(clean)) return "https://" + clean.slice("http://".length);
  return "https://" + clean.replace(/^\/+/, "");
}

/** _settings.gridLayout ("", "2", "3") değerine göre .cards-grid için ek sınıf üretir. */
function gridLayoutClass() {
  if (_settings.gridLayout === "2") return " grid-cols-2";
  if (_settings.gridLayout === "3") return " grid-cols-3";
  return "";
}

let _settings = {}; 
let _allItems = [];
let _currentKafeId = null; // Yorum gönderimi gibi diğer fonksiyonların erişebilmesi için geçerli kafe_id burada tutulur
let _currentLang = "tr";   // Aktif görüntüleme dili — detectInitialLang() ile DOMContentLoaded'da belirlenir
let _selectedReviewStars = 0; // "Menüyü Değerlendir" modalı — seçili yıldız sayısı (1-5)

// ─── INIT ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Çoklu dil: sayfa render edilmeden ÖNCE aktif dili belirle ki hem statik
  // arayüz metinleri hem de olası hata ekranları doğru dilde çıksın.
  _currentLang = detectInitialLang();
  applyStaticTranslations();
  initLangSwitcher();

  // PWA: Service Worker'ı kaydet ve çevrimdışı/çevrimiçi göstergesini
  // başlat. İkisi de kafe_id'den bağımsızdır, bu yüzden erken çalıştırılır.
  registerServiceWorker();
  initOfflineIndicator();

  // ── HARDCODED SÜRÜM ─────────────────────────────────────
  // Kafe kimliği URL'den (?kafe=...) DEĞİL, dosyanın en üstünde tanımlı
  // HARDCODED_KAFE_ID sabitinden gelir. Bu yüzden sanitizeKafeId() /
  // URLSearchParams tabanlı doğrulama ve "kafe bulunamadı" fatal-error
  // kontrolü bu sürümde tamamen kaldırılmıştır.
  _currentKafeId = HARDCODED_KAFE_ID;

  // PWA: "Ana Ekrana Ekle" ile eklenen ikon zaten bu tek işletmeye ait
  // olduğu için manifest artık kafe_id'siz, sabit './index.html' ile
  // üretilir (bkz. fonksiyon içindeki mimari not).
  setupDynamicManifest();

  initScrollTop();
  initTouchCards();
  initLightbox();
  initSearch();
  initReviewModal();
  initStickyOffsetSync();

  fetchMenuData(HARDCODED_KAFE_ID);
});

// ════════════════════════════════════════════════════════
//  ÇOKLU DİL (İ18N) — TR / EN
// ════════════════════════════════════════════════════════
//
// Mimari özet:
//  • Ürün adı/açıklaması gibi İŞLETMEYE ÖZEL içerikler admin panelden
//    girilen "translations.en" alanından okunur (bkz. localizeItem()).
//    Çeviri girilmemişse SESSİZCE Türkçe metne geri düşülür — müşteri asla
//    boş bir alan görmez.
//  • "Menüde ara…", "ÜRÜN" gibi SABİT arayüz metinleri ise bu dosyadaki
//    UI_STRINGS sözlüğünden okunur (t() fonksiyonu).
//  • Aktif dil tercihi (kullanıcı elle değiştirdiyse) localStorage'da
//    saklanır — bir sonraki ziyarette navigator.language'ı değil, son
//    seçimi hatırlar. localStorage kapalıysa (gizli sekme vb.) sessizce
//    yok sayılır, uygulama navigator.language fallback'ine döner.

const SUPPORTED_LANGS = ["tr", "en"];
const LANG_STORAGE_KEY = "hankafem_lang";

const UI_STRINGS = {
  tr: {
    searchPlaceholder:   "Menüde ara…",
    searchClearLabel:    "Aramayı temizle",
    scrollTopLabel:      "Yukarı çık",
    productCountSuffix:  "ÜRÜN",
    emptyMenu:           "Menüde henüz ürün bulunamadı.",
    searchResultsTitle:  "Arama Sonuçları",
    noSearchResult:      '"{query}" için sonuç bulunamadı.',
    loadError:           "Menü yüklenirken bir sorun oluştu. Lütfen sayfayı yenileyin.",
    reloadHint:          "Sayfayı yenileyip tekrar deneyin.",
    fatalTitleInvalid:   "İşletme Bulunamadı veya QR Kod Geçersiz",
    fatalDetailInvalid:  "Bu bağlantı geçersiz görünüyor. Lütfen QR kodunuzu tekrar taratın.",
    fatalDetailNotFound: "Bu işletmeye ait bir menü henüz oluşturulmamış veya sistemde bulunamıyor.",
    offlineMessage:      "Şu an çevrimdışı moddasınız, menüyü gezmeye devam edebilirsiniz.",
    crossSellTitle:      "Bunun Yanına İyi Gider",
    reviewOpenBtnLabel:  "Değerlendirme için tıklayınız",
    reviewModalTitle:    "Menüyü Değerlendir",
    reviewModalSub:      "Deneyiminizi bizimle paylaşın.",
    reviewCommentPlaceholder: "Yorumunuz (opsiyonel)…",
    reviewSubmitLabel:   "Gönder",
    reviewAlreadyDoneMsg: "Bugün için değerlendirmenizi zaten aldık. Yarın tekrar bekleriz! 🙏",
    reviewSuccessMsg:    "Teşekkürler! Değerlendirmeniz bizim için çok değerli. ✨",
    reviewStarsRequiredError: "Lütfen en az 1 yıldız seçin.",
    reviewNetworkError:  "Gönderilemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.",
    heroCtaDefaultLabel: "Reklam videosu için tıklayınız"
  },
  en: {
    searchPlaceholder:   "Search the menu…",
    searchClearLabel:    "Clear search",
    scrollTopLabel:      "Scroll to top",
    productCountSuffix:  "ITEMS",
    emptyMenu:           "No products found in the menu yet.",
    searchResultsTitle:  "Search Results",
    noSearchResult:      'No results found for "{query}".',
    loadError:           "There was a problem loading the menu. Please refresh the page.",
    reloadHint:          "Please refresh the page and try again.",
    fatalTitleInvalid:   "Business Not Found or Invalid QR Code",
    fatalDetailInvalid:  "This link appears to be invalid. Please scan your QR code again.",
    fatalDetailNotFound: "A menu for this business has not been created yet or could not be found.",
    offlineMessage:      "You're currently offline — you can keep browsing the menu.",
    crossSellTitle:      "Goes Great With This",
    reviewOpenBtnLabel:  "Click to rate us",
    reviewModalTitle:    "Rate the Menu",
    reviewModalSub:      "Share your experience with us.",
    reviewCommentPlaceholder: "Your comment (optional)…",
    reviewSubmitLabel:   "Submit",
    reviewAlreadyDoneMsg: "We've already received your review for today. Please come back tomorrow! 🙏",
    reviewSuccessMsg:    "Thank you! We really appreciate your feedback. ✨",
    reviewStarsRequiredError: "Please select at least 1 star.",
    reviewNetworkError:  "Couldn't submit. Please check your connection and try again.",
    heroCtaDefaultLabel: "Click to view the ad"
  }
};

/** Aktif dile göre bir arayüz metni döner; eksikse TR'ye, o da yoksa boş string'e düşer. */
function t(key) {
  return (UI_STRINGS[_currentLang] && UI_STRINGS[_currentLang][key])
    ?? UI_STRINGS.tr[key]
    ?? "";
}

/**
 * Başlangıç dilini belirler. Öncelik sırası:
 *   1) URL'deki ?lang=tr|en (paylaşılan/QR linkine gömülmüş açık tercih)
 *   2) Kullanıcının daha önce elle seçtiği ve localStorage'a kaydedilen dil
 *   3) navigator.language (tarayıcı/cihaz dili) — "tr" ile başlamıyorsa "en"
 *      varsayılır (iki dilli bir sistemde en güvenli varsayılan budur).
 */
function detectInitialLang() {
  const urlLang = new URLSearchParams(window.location.search).get("lang");
  if (urlLang && SUPPORTED_LANGS.includes(urlLang.toLowerCase())) {
    return urlLang.toLowerCase();
  }

  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch {
    // localStorage erişilemez olabilir (gizli sekme / kısıtlı ortam) — yok say
  }

  const nav = String(navigator.language || navigator.userLanguage || "tr").toLowerCase();
  return nav.startsWith("tr") ? "tr" : "en";
}

/** TR/EN buton grubunu dinler ve tıklanan dile geçiş yapar. */
function initLangSwitcher() {
  const trBtn = document.getElementById("lang-btn-tr");
  const enBtn = document.getElementById("lang-btn-en");
  if (!trBtn || !enBtn) return;

  updateLangSwitcherUI();

  trBtn.addEventListener("click", () => setLang("tr"));
  enBtn.addEventListener("click", () => setLang("en"));
}

/** TR/EN butonlarının görsel aktif/pasif durumunu _currentLang ile senkronize eder. */
function updateLangSwitcherUI() {
  const trBtn = document.getElementById("lang-btn-tr");
  const enBtn = document.getElementById("lang-btn-en");
  if (!trBtn || !enBtn) return;

  trBtn.classList.toggle("is-active", _currentLang === "tr");
  enBtn.classList.toggle("is-active", _currentLang === "en");
  trBtn.setAttribute("aria-pressed", String(_currentLang === "tr"));
  enBtn.setAttribute("aria-pressed", String(_currentLang === "en"));
}

/**
 * Dili değiştirir ve SAYFA YENİLENMEDEN menüyü + statik metinleri yeni dilde
 * tekrar çizer. Menü henüz yüklenmediyse (fetchMenuData sürüyorsa) burada
 * ekstra bir şey yapmaya gerek yok — fetchMenuData tamamlandığında zaten
 * güncel _currentLang değeriyle ilk render'ı yapacak.
 */
function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang) || lang === _currentLang) return;
  _currentLang = lang;

  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* gizli sekme vb. — yok say */ }

  applyStaticTranslations();
  updateLangSwitcherUI();

  if (_allItems.length) {
    // Aktif bir arama sorgusu varsa onu da yeni dilde tekrar uygula,
    // yoksa menünün tamamını yeni dilde yeniden çiz.
    const searchInput  = document.getElementById("search-input");
    const activeQuery  = searchInput ? searchInput.value.trim() : "";
    activeQuery ? filterMenu(activeQuery) : renderFull(_allItems);
  }
}

/** Sayfadaki sabit (statik) arayüz metinlerini aktif dile göre günceller. */
function applyStaticTranslations() {
  document.documentElement.lang = _currentLang;

  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.placeholder = t("searchPlaceholder");

  const searchClear = document.getElementById("search-clear");
  if (searchClear) searchClear.setAttribute("aria-label", t("searchClearLabel"));

  const scrollTopBtn = document.getElementById("scroll-top-btn");
  if (scrollTopBtn) scrollTopBtn.setAttribute("aria-label", t("scrollTopLabel"));

  // Banner o an gizli olsa bile metnini güncel tutuyoruz — bir dahaki
  // gösterildiğinde (offline event) doğru dilde çıksın.
  const offlineText = document.getElementById("offline-banner-text");
  if (offlineText) offlineText.textContent = t("offlineMessage");

  // "Menüyü Değerlendir" modalı — statik metinler (modal o an gizli olsa
  // bile güncellenir, bkz. offline-banner ile aynı desen).
  const reviewOpenLabel = document.getElementById("review-open-btn-label");
  if (reviewOpenLabel) reviewOpenLabel.textContent = t("reviewOpenBtnLabel");

  const reviewModalTitleEl = document.getElementById("review-modal-title");
  if (reviewModalTitleEl) reviewModalTitleEl.textContent = t("reviewModalTitle");

  const reviewModalSubEl = document.getElementById("review-modal-sub");
  if (reviewModalSubEl) reviewModalSubEl.textContent = t("reviewModalSub");

  const reviewCommentEl = document.getElementById("review-comment");
  if (reviewCommentEl) reviewCommentEl.placeholder = t("reviewCommentPlaceholder");

  const reviewSubmitTextEl = document.querySelector("#review-submit-btn .review-submit-btn-text");
  if (reviewSubmitTextEl) reviewSubmitTextEl.textContent = t("reviewSubmitLabel");

  const reviewAlreadyDoneTextEl = document.getElementById("review-already-done-text");
  if (reviewAlreadyDoneTextEl) reviewAlreadyDoneTextEl.textContent = t("reviewAlreadyDoneMsg");

  const reviewSuccessTextEl = document.getElementById("review-success-text");
  if (reviewSuccessTextEl) reviewSuccessTextEl.textContent = t("reviewSuccessMsg");
}

// ════════════════════════════════════════════════════════
//  PWA — SERVICE WORKER KAYDI + DİNAMİK MANİFEST
// ════════════════════════════════════════════════════════
//
// sw.js, index.html ile AYNI klasörde (proje kökünde) bulunmalıdır. Kayıt,
// sayfanın "load" olayına ertelenir — kritik ilk yükleme (menü verisi,
// görseller) ile ağ/CPU kaynağı için YARIŞMAMASI için kasıtlı bir tercihtir
// ("maksimum performans" felsefesi, bkz. dosya başlığı).
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return; // eski tarayıcı — sessizce atla

  // ── OTOMATİK GÜNCELLEME ─────────────────────────────────
  // sw.js zaten skipWaiting() + clients.claim() ile yeni sürümü hemen
  // devralıyor — ama AÇIK SEKME bunu kendiliğinden fark edip yenilenmez.
  // "controllerchange" olayı tam bu anı yakalar: yeni SW devraldığı anda
  // sayfayı BİR KEZ otomatik yeniliyoruz. Böylece kullanıcı/işletme sahibi
  // elle "önbelleği temizle" yapmak zorunda kalmadan her zaman en güncel
  // index.html/app.js/style.css ile karşılaşır.
  let _swRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swRefreshing) return; // birden fazla tetiklenmeye karşı koruma
    _swRefreshing = true;
    showToast("Yeni sürüm yükleniyor…");
    setTimeout(() => window.location.reload(), 600);
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .then(reg => {
        console.info("[HanKafem][PWA] Service Worker kayıtlı. Scope:", reg.scope);

        // Tarayıcılar SW script'inin değişip değişmediğini varsayılan
        // olarak günde en fazla 1 kez kontrol eder. Sekme her ön plana
        // geldiğinde (kullanıcı geri döndüğünde) manuel bir update()
        // tetikleyerek yeni bir deploy varsa çok daha hızlı fark edilmesini
        // sağlıyoruz — hâlâ ekstra ağ/CPU maliyeti yaratmadan (sadece
        // sw.js'in birkaç KB'lık byte karşılaştırması).
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update();
        });
      })
      .catch(err => {
        // Kayıt başarısız olsa bile (ör. http üzerinden localhost dışı test,
        // ya da tarayıcı desteği yoksa) müşteri deneyimi ETKİLENMEZ — SW
        // yoksa uygulama normal (online-only) bir web sitesi gibi çalışmaya
        // devam eder.
        console.warn("[HanKafem][PWA] Service Worker kaydı başarısız:", err);
      });
  });
}

/**
 * PWA: manifest.json'u yeniden üretir ve <link rel="manifest"> etiketinin
 * href'ini buna yönlendirir.
 *
 * HARDCODED SÜRÜM NOTU: Standart (çok kiracılı) sürümde start_url, kafe_id
 * gömülü bir query string taşıyordu (multi-tenant senaryosunda "Ana Ekrana
 * Ekle" ikonunun her zaman doğru kafeye dönmesi için). Bu dosya TEK bir
 * işletmeye özel olduğundan buna gerek yoktur — start_url doğrudan sabit
 * "./index.html" olarak üretilir.
 *
 * Fonksiyon yine de shopName bilindiğinde (settings yüklendiğinde) "Ana
 * Ekrana Ekle" istemindeki jenerik ismi işletmenin gerçek adıyla
 * değiştirmek için TEKRAR çağrılır (bkz. applySettingsToDOM).
 *
 * @param {string} [shopName]
 */
function setupDynamicManifest(shopName) {
  fetch("manifest.json")
    .then(res => {
      if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
      return res.json();
    })
    .then(base => {
      const scopedUrl = "./index.html";
      const scopedManifest = {
        ...base,
        name:       shopName ? `${shopName} — Dijital Menü` : base.name,
        short_name: shopName ? String(shopName).slice(0, 20) : base.short_name,
        start_url:  scopedUrl,
        id:         scopedUrl
      };

      const blob = new Blob([JSON.stringify(scopedManifest)], { type: "application/manifest+json" });
      const blobUrl = URL.createObjectURL(blob);

      let link = document.querySelector('link[rel="manifest"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "manifest";
        document.head.appendChild(link);
      }
      link.href = blobUrl;
    })
    .catch(err => {
      // Dinamik manifest üretilemezse index.html'deki STATİK manifest.json
      // linki geçerliliğini korur — "Ana Ekrana Ekle" yine çalışır. Müşteri
      // deneyimi hiçbir şekilde bloklanmaz.
      console.warn("[HanKafem][PWA] Dinamik manifest oluşturulamadı:", err);
    });
}

// ─── ÇEVRİMDIŞI / ÇEVRİMİÇİ DURUM GÖSTERGESİ ──────────────
// index.html içinde #offline-banner zaten hazır (hidden) — burada sadece
// gösterilip gizleniyor. Header'ın İÇİNDE, normal akışta bir satır olduğu
// için (bkz. style.css notu) sayfanın geri kalanının layout'unu etkilemez.
function initOfflineIndicator() {
  window.addEventListener("offline", showOfflineBanner);
  window.addEventListener("online", hideOfflineBanner);

  // Sayfa zaten çevrimdışı bir durumda açıldıysa (ör. önbellekten, uçak
  // modunda) banner'ı baştan göster — "offline" olayını beklemeye gerek yok.
  if (!navigator.onLine) showOfflineBanner();
}

function showOfflineBanner() {
  const banner  = document.getElementById("offline-banner");
  const textEl  = document.getElementById("offline-banner-text");
  if (!banner) return;
  if (textEl) textEl.textContent = t("offlineMessage");
  banner.hidden = false;
  syncStickyOffsets(); // banner header'ı büyüttüğü için sticky offsetleri güncelle
}

function hideOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (banner) banner.hidden = true;
  syncStickyOffsets();
}

// ════════════════════════════════════════════════════════
//  GÜNÜN FIRSATI (PROMOSYON BANNER'I) + STICKY OFFSET SENKRONİZASYONU
// ════════════════════════════════════════════════════════
//
// settings/general → dailyDealText / dailyDealActive alanlarından beslenir
// (bkz. scriptAdmin.js → handleHeroSave()). Header'ın içinde, normal akışta
// bir satır olarak render edilir (offline-banner ile birebir aynı mimari
// desen) — bu yüzden görünür/gizli her değiştiğinde header'ın GERÇEK
// yüksekliği değişir. #search-bar-wrap ve #cat-nav'daki sabit "top" CSS
// değerleri (61px / 109px) bu değişikliği otomatik yakalayamayacağı için,
// syncStickyOffsets() her banner geçişinde ve pencere yeniden boyutlandı-
// rıldığında bu iki elemanın "top" stilini gerçek offsetHeight'a göre
// elle yeniden hesaplar.
function applyDailyDealBanner() {
  const banner = document.getElementById("promo-banner");
  const textEl = document.getElementById("promo-banner-text");
  if (!banner || !textEl) return;

  const text = str(_settings.dailyDealText);
  const active = !!_settings.dailyDealActive && !!text;

  textEl.textContent = text;
  banner.hidden = !active;
  syncStickyOffsets();
}

function syncStickyOffsets() {
  const header    = document.getElementById("site-header");
  const searchBar = document.getElementById("search-bar-wrap");
  const catNav    = document.getElementById("cat-nav");
  const hero      = document.getElementById("hero");
  if (!header) return;

  const headerH = header.offsetHeight;
  if (searchBar) searchBar.style.top = `${headerH}px`;
  if (catNav)    catNav.style.top    = `${headerH + (searchBar ? searchBar.offsetHeight : 0)}px`;

  // Hero Alanı Gizliyse (bkz. applySettingsToDOM → "Hero Alanını Gizle"):
  // normalde bu üst boşluğu #hero'nun kendi padding'i sağlıyordu; hero tam
  // olarak kaldırıldığında sabit (fixed) header'ın arama çubuğunu/menüyü
  // ezmemesi için aynı boşluğu artık body üzerinden veriyoruz.
  const heroIsHidden = hero && hero.classList.contains("hero-section-hidden");
  document.body.style.paddingTop = heroIsHidden ? `${headerH}px` : "";
}

/** Pencere yeniden boyutlandırıldığında (ör. cihaz döndürüldüğünde, banner
 * metni satır sayısını değiştirdiğinde) sticky offsetleri debounce'lu
 * şekilde tazeler. */
function initStickyOffsetSync() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncStickyOffsets, 150);
  }, { passive: true });
}

// ════════════════════════════════════════════════════════
//  MÜŞTERİ YORUMLARI (Rate-Limited Değerlendirme Formu)
// ════════════════════════════════════════════════════════
//
// ⚠️ FIRESTORE SECURITY RULES HATIRLATMASI ⚠️
// Bu fonksiyon Firebase SDK KULLANMAZ — bu dosyanın "Firebase SDK Bağımlılığı
// SIFIR" felsefesine (bkz. dosya başlığı) sadık kalmak için Firestore'a
// doğrudan REST API üzerinden, imzasız (unauthenticated) bir POST isteğiyle
// "cafes/{kafe_id}/reviews" koleksiyonuna yeni bir doküman eklenir. Bu
// isteğin güvenliği istemci tarafında değil, Firestore Security Rules
// tarafında sağlanır — kurallarda aşağıdaki bloğun tanımlı olduğundan emin
// olun:
//
//   match /cafes/{kafeId}/reviews/{reviewId} {
//     allow create: if true;
//     allow read, delete: if request.auth != null && request.auth.uid == kafeId;
//     allow update: if false;
//   }
//
const FIRESTORE_PROJECT_ID = "han-kafem-menu";
const FIRESTORE_REST_ENDPOINT =
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

// ÖNEMLİ NOT — GÜNLÜK KİLİT (RATE LIMIT) BİR GÜVENLİK ÖNLEMİ DEĞİLDİR:
// Cihaz bazlı "günde 1 yorum" kısıtı TAMAMEN istemci tarafında, localStorage
// ile sağlanır — sadece iyi niyetli kullanıcılar için bir UX kolaylığıdır.
// localStorage'ı temizleyen bir kullanıcı tekrar yorum gönderebilir; gerçek
// kötüye kullanım koruması gerekiyorsa bu iş sunucu tarafında (ör. Cloud
// Functions + App Check) ele alınmalıdır.

const REVIEW_LOCK_PREFIX = "hankafem_review_lock_"; // + kafeId → localStorage key

/** Bir Date nesnesini "YYYY-MM-DD" biçiminde yerel gün anahtarına çevirir
 * (scriptAdmin.js'teki aynı isimli fonksiyonla birebir aynı sözleşme). */
function _dayKey(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bu cihazdan bugün için zaten bir yorum gönderilmiş mi? */
function hasReviewedToday(kafeId) {
  try {
    const stored = localStorage.getItem(REVIEW_LOCK_PREFIX + kafeId);
    return stored === _dayKey(new Date());
  } catch {
    return false; // localStorage erişilemez (gizli sekme vb.) — kilitlemeyi devre dışı bırak
  }
}

/** Bugünün tarihini bu kafe_id için localStorage'a kilit olarak yazar. */
function lockReviewForToday(kafeId) {
  try {
    localStorage.setItem(REVIEW_LOCK_PREFIX + kafeId, _dayKey(new Date()));
  } catch {
    // localStorage erişilemez — sessizce yok say (kullanıcı deneyimi etkilenmez)
  }
}

function initReviewModal() {
  const openBtn    = document.getElementById("review-open-btn");
  const modal      = document.getElementById("review-modal");
  const backdrop    = document.getElementById("review-modal-backdrop");
  const closeBtn    = document.getElementById("review-modal-close");
  const starPicker  = document.getElementById("review-star-picker");
  const submitBtn   = document.getElementById("review-submit-btn");
  if (!openBtn || !modal) return;

  openBtn.addEventListener("click", openReviewModal);
  backdrop.addEventListener("click", closeReviewModal);
  closeBtn.addEventListener("click", closeReviewModal);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !modal.hidden) closeReviewModal();
  });

  starPicker?.querySelectorAll(".review-star").forEach(starBtn => {
    starBtn.addEventListener("click", () => {
      _selectedReviewStars = Number(starBtn.dataset.star) || 0;
      updateStarPickerUI();
    });
  });

  submitBtn.addEventListener("click", handleReviewSubmit);
}

function updateStarPickerUI() {
  const starPicker = document.getElementById("review-star-picker");
  if (!starPicker) return;
  starPicker.querySelectorAll(".review-star").forEach(starBtn => {
    const val = Number(starBtn.dataset.star) || 0;
    starBtn.classList.toggle("is-active", val <= _selectedReviewStars);
  });
}

function openReviewModal() {
  if (!_currentKafeId) return;

  const modal       = document.getElementById("review-modal");
  const formWrap    = document.getElementById("review-form-wrap");
  const alreadyDone = document.getElementById("review-already-done");
  const successEl   = document.getElementById("review-success");
  const errEl       = document.getElementById("review-error");
  const commentEl   = document.getElementById("review-comment");

  // Formu her açılışta sıfırla — bir önceki (kapatılmış/gönderilmiş)
  // oturumdan kalan durum bir daha kullanıcıya YANLIŞLIKLA gösterilmesin.
  _selectedReviewStars = 0;
  updateStarPickerUI();
  if (commentEl) commentEl.value = "";
  if (errEl) errEl.hidden = true;
  successEl.hidden = true;

  if (hasReviewedToday(_currentKafeId)) {
    formWrap.hidden = true;
    alreadyDone.hidden = false;
  } else {
    formWrap.hidden = false;
    alreadyDone.hidden = true;
  }

  modal.hidden = false;
}

function closeReviewModal() {
  const modal = document.getElementById("review-modal");
  if (modal) modal.hidden = true;
}

async function handleReviewSubmit() {
  const errEl     = document.getElementById("review-error");
  const submitBtn = document.getElementById("review-submit-btn");
  const btnText   = submitBtn.querySelector(".review-submit-btn-text");
  const btnSpin   = submitBtn.querySelector(".review-submit-btn-spinner");
  const commentEl = document.getElementById("review-comment");
  const formWrap  = document.getElementById("review-form-wrap");
  const successEl = document.getElementById("review-success");

  errEl.hidden = true;

  if (_selectedReviewStars < 1) {
    errEl.textContent = t("reviewStarsRequiredError");
    errEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  btnText.textContent = "…";
  btnSpin.hidden = false;

  const rating  = _selectedReviewStars;
  const comment = (commentEl.value || "").trim().slice(0, 300);

  try {
    const ok = await submitReviewToFirestore(_currentKafeId, rating, comment);
    if (!ok) throw new Error("submit-failed");

    // Kilit SADECE başarılı bir yanıt alındıktan sonra ayarlanır — bir ağ
    // hatası kullanıcıyı haksız yere bir sonraki güne kadar kilitlemesin.
    lockReviewForToday(_currentKafeId);
    formWrap.hidden = true;
    successEl.hidden = false;
  } catch (err) {
    console.warn("[HanKafem][Yorum] gönderilemedi:", err);
    errEl.textContent = t("reviewNetworkError");
    errEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = t("reviewSubmitLabel");
    btnSpin.hidden = true;
  }
}

/**
 * Bir müşteri değerlendirmesini Firestore'daki "cafes/{kafe_id}/reviews"
 * koleksiyonuna, imzasız bir Firestore REST API isteğiyle ekler.
 * @returns {Promise<boolean>} İstek HTTP 2xx ile sonuçlandıysa true.
 */
async function submitReviewToFirestore(kafeId, rating, comment) {
  const fields = {
    rating:    { integerValue: String(rating) },
    timestamp: { timestampValue: new Date().toISOString() }
  };
  if (comment) fields.comment = { stringValue: comment };

  const url = `${FIRESTORE_REST_ENDPOINT}/cafes/${encodeURIComponent(kafeId)}/reviews?key=AIzaSyDiD-s83-ehfUSF0nT6kO9S-yF-hu-PjWo`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`[HanKafem][Yorum] HTTP ${res.status}:`, errBody);
    return false;
  }
  return true;
}

// ─── VERİ ÇEKME (Doğrudan Bulut Sunucusundan) ────────────
async function fetchMenuData(kafeId) {
  showLoading();

  try {
    // 2. Firebase Storage REST API Endpoint'ini oluşturuyoruz.
    // Dosya yolu URL encode edilmeli (örn: public_menus%2FUID.json)
    const bucketName = "han-kafem-menu.firebasestorage.app";
    const filePath = encodeURIComponent(`public_menus/${kafeId}.json`);

    // ?alt=media parametresi dosyanın içeriğini JSON olarak indirmemizi sağlar.
    // NOT: Cache-busting (?t=Date.now()) KASITLI OLARAK kaldırıldı — bu parametre
    // her istekte farklı bir URL ürettiği için CDN/tarayıcı önbelleğini tamamen
    // devre dışı bırakıyordu (her ziyarette sıfırdan indirme = yavaş + gereksiz trafik).
    //
    // Bunun yerine "no-cache" modu kullanıyoruz: tarayıcı önbellekteki kopyayı
    // ASLA doğrudan kullanmaz, her seferinde sunucuya ETag ile "değişti mi?" diye
    // sorar (If-None-Match). Değişmediyse sunucu 304 döner (çok hızlı, veri
    // indirilmez) — değiştiyse (admin panelden güncelleme sonrası) yeni JSON
    // gelir. Böylece hem eski veri asla gösterilmez hem de CDN/tarayıcı
    // önbelleği (Cache-Control header'ı) tamamen devre dışı kalmaz.
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${filePath}?alt=media`;

    const res = await fetch(url, { cache: "no-cache" });
    
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) throw new Error("not-found");
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    // ── Settings bloğunu işle ──
    _settings = data.settings || {};
    applySettingsToDOM();

    // ── Ürün listesini işle ──
    const raw = Array.isArray(data.products) ? data.products : [];
    const items = raw
      .map(d => ({
        id:       str(d.id),
        category: str(d.category),
        name:     str(d.name),
        price:    str(d.price),
        desc:     str(d.desc),
        image:    str(d.image),
        badge:    str(d.badge),
        tags:     Array.isArray(d.tags) ? d.tags.map(str) : [],
        extras:   Array.isArray(d.extras)
                    ? d.extras.map(ex => ({ name: str(ex?.name), price: str(ex?.price) })).filter(ex => ex.name)
                    : [],
        crossSellIds: Array.isArray(d.crossSellIds) ? d.crossSellIds.map(str) : [],
        translations: normalizeTranslations(d.translations),
        active:   d.active !== false,
        showPhoto: d.showPhoto !== false,
        order:    Number(d.order) || 9999
      }))
      .sort((a, b) => a.order - b.order);

    _allItems = items;
    renderFull(items);

  } catch (err) {
    console.error("[HanKafem] Menü yüklenemedi:", err);
    if (err.message === "not-found") {
      showFatalError(t("fatalTitleInvalid"), t("fatalDetailNotFound"));
    } else {
      showError(t("loadError"));
    }
  }
}

// ─── SETTINGS → DOM ──────────────────────────────────────
function applySettingsToDOM() {
  const logoImg = document.getElementById("hdr-logo-img");
  if (_settings.logoUrl && logoImg) logoImg.src = toCdnUrl(_settings.logoUrl);

  const brandName = document.getElementById("hdr-brand-name");
  if (_settings.shopName && brandName) brandName.textContent = _settings.shopName;

  // PWA: gerçek işletme adı artık bilindiğine göre, "Ana Ekrana Ekle"
  // istemindeki jenerik ismi işletmenin gerçek adıyla değiştirmek için
  // manifest'i tekrar üret (bkz. setupDynamicManifest içindeki not).
  if (_settings.shopName) {
    setupDynamicManifest(_settings.shopName);
  }

  const cnText   = document.querySelector(".cn-text");
  const cnAuthor = document.querySelector(".cn-author");
  if (_settings.closingTitle  && cnText)   cnText.textContent   = _settings.closingTitle;
  if (_settings.closingAuthor && cnAuthor) cnAuthor.textContent = _settings.closingAuthor;

  // ─ Tema + Görünüm Modu → body class ─
  const THEME_CLASSES = ["theme-dark", "theme-light", "theme-emerald", "theme-terracotta"];
  THEME_CLASSES.forEach(c => document.body.classList.remove(c));
  const theme = _settings.theme || "theme-dark";
  if (theme !== "theme-dark") document.body.classList.add(theme);

  // ─ Arayüz Boyutu (UI Scale) → body class ─
  const UI_SIZE_CLASSES = ["ui-size-md", "ui-size-sm"];
  UI_SIZE_CLASSES.forEach(c => document.body.classList.remove(c));
  if (_settings.uiSize === "md" || _settings.uiSize === "sm") {
    document.body.classList.add(`ui-size-${_settings.uiSize}`);
  }

  // ─ Instagram linki (+ linkten türetilen kullanıcı adı) ─
  // Link tanımlıysa buton görünür olur ve metni linkten türetilen kullanıcı
  // adıyla güncellenir; link yoksa buton "display:none" ile tamamen gizlenir.
  const igEls = document.querySelectorAll(".footer-ig, [data-ig-link]");
  if (_settings.igLink) {
    const igUsername = igUsernameFromLink(_settings.igLink);
    igEls.forEach(a => {
      a.href = ensureHttpsUrl(_settings.igLink);
      const span = a.querySelector("span");
      if (span) span.textContent = igUsername || "Instagram";
      a.style.display = ""; // inline stili kaldır → CSS'teki display:flex tekrar geçerli olur
    });
  } else {
    igEls.forEach(a => { a.style.display = "none"; });
  }

  // Hero Alanını Gizle — aktifse müşteri sayfası doğrudan kategori/menü
  // listesiyle başlar (bkz. style.css → #hero.hero-section-hidden).
  document.getElementById("hero")
    ?.classList.toggle("hero-section-hidden", !!_settings.heroHidden);

  // Günün Fırsatı — Promosyon Banner'ı (kendi içinde syncStickyOffsets() çağırır)
  applyDailyDealBanner();

  // Slider'ı başlat — HARDCODED SÜRÜM: "Cilveli Kahve" videosu, admin
  // panelinden gelen heroMediaList'ten bağımsız olarak, bu tek müşteriye
  // özel bir "imza" slayt olarak listenin EN BAŞINA sabit eklenir. Orijinal
  // _settings.heroMediaList mutasyona uğramasın diye önce kopyalanır.
  const heroMediaList = Array.isArray(_settings.heroMediaList) ? [..._settings.heroMediaList] : [];
  heroMediaList.unshift({
    type:     "video",
    url:      "images/cilve3.mp4",
    eyebrow:  "ÖZEL TARİF",
    title:    "Cilveli Kahvemizi",
    titleEm:  "Denediniz mi?",
    sub:      "Bademli, kadifemsi, eşsiz bir deneyim.",
    duration: 8000
  });
  initHeroSlider(heroMediaList);
}

// ════════════════════════════════════════════════════════
//  MASONRY GRID (Karma Mod — Kartlar Arası Dikey Boşluk Giderme)
// ════════════════════════════════════════════════════════
//
// SORUN: CSS Grid, bir satırın yüksekliğini o satırdaki EN UZUN öğeye göre
// belirler. Fotoğraflı (uzun) ve fotoğrafsız/boxed (kısa) kartlar aynı
// satıra denk geldiğinde, "align-items:start" kısa kartın o boşluğa doğru
// GERİLMESİNİ önler ama boşluğun kendisini (bir sonraki satırın o uzun
// karta göre başlaması) GİDEREMEZ.
//
// ÇÖZÜM (saf Vanilla JS + CSS Grid, framework/kütüphane YOK):
// style.css → .cards-grid'de satırları çok ince bir birime bölüyoruz
// (grid-auto-rows: 8px) ve her karta GERÇEK render yüksekliğine göre
// "grid-row-end: span N" atıyoruz. Tarayıcının varsayılan (sparse) grid
// auto-placement algoritması bu span'lara göre bir sonraki kartı DOM
// sırasındaki ilk boş hücreye yerleştirir — bu da CSS `column-count`
// çözümünün aksine ürünlerin (1, 2, 3...) soldan-sağa / yukarıdan-aşağıya
// okuma sırasını BOZMADAN kısa kartların altındaki boşluğu doldurur.
//
// PERFORMANS: Her karta ayrı bir ResizeObserver bağlanır. Bu sayede:
//  - Lazy-load ile sonradan yüklenen bir görsel kartın boyunu değiştirdiğinde,
//  - Pencere yeniden boyutlandırılıp grid kolon genişliği (dolayısıyla
//    kartların satır kırılımı/yüksekliği) değiştiğinde,
// span otomatik yeniden hesaplanır — ayrı bir "resize" dinleyicisine veya
// polling'e/setInterval'a gerek KALMAZ (maksimum performans, minimum kod).
const MASONRY_ROW_UNIT = 8; // style.css / styleAdmin.css → .cards-grid { grid-auto-rows } İLE BİREBİR AYNI OLMALI

let _masonryObservers = []; // önceki render'lardan kalan ResizeObserver'lar — her yeniden render'da temizlenir

/**
 * root içindeki TÜM .cards-grid'lere masonry span hesaplamasını uygular.
 * renderFull() ve filterMenu() içinde, DOM'a innerHTML basıldıktan HEMEN
 * sonra çağrılmalıdır. Menü ne zaman yeniden render edilirse edilsin
 * (arama temizlendiğinde, dil değiştiğinde vb.) önce eski ResizeObserver'lar
 * disconnect edilir — aksi halde her render'da birikip performansı düşürür.
 */
function initMasonryGrids(root) {
  _masonryObservers.forEach(ro => ro.disconnect());
  _masonryObservers = [];

  if (!root || !("ResizeObserver" in window)) return; // eski tarayıcı — sessizce normal grid akışına düş

  root.querySelectorAll(".cards-grid").forEach(grid => {
    const gapPx = parseFloat(getComputedStyle(grid).getPropertyValue("--card-gap")) || 16;

    const layoutCard = (card) => {
      const h = card.getBoundingClientRect().height;
      if (!h) return; // henüz layout alınmamış (display:none vb.) — atla
      const span = Math.max(1, Math.ceil((h + gapPx) / MASONRY_ROW_UNIT));
      card.style.gridRowEnd = `span ${span}`;
    };

    const ro = new ResizeObserver(entries => {
      entries.forEach(entry => layoutCard(entry.target));
    });

    Array.from(grid.children).forEach(card => {
      layoutCard(card); // ResizeObserver'ın ilk callback'ini beklemeden anında yerleştir
      ro.observe(card);
    });

    _masonryObservers.push(ro);
  });
}

// ─── RENDER (mevcut tasarım — vitrin) ────────────────────
function renderFull(items) {
  const root = document.getElementById("menu-root");
  if (!root) return;

  if (!items?.length) {
    root.innerHTML = `<div class="lux-error">${esc(t("emptyMenu"))}</div>`;
    buildCategoryNav([]);
    return;
  }

  // Çoklu Dil: her ürünü aktif dile göre çözümle (EN çevirisi varsa onu,
  // yoksa orijinal TR metni kullan). Kategori adları çeviri kapsamında
  // DEĞİLDİR (bkz. localizeItem) — kategori grupları TR ismiyle kalır.
  const localizedItems = items.map(it => localizeItem(it, _currentLang));

  const catOrder = [];
  const byCat    = {};
  localizedItems.forEach(it => {
    if (!byCat[it.category]) { byCat[it.category] = []; catOrder.push(it.category); }
    byCat[it.category].push(it);
  });

  const orderedCats = applyCategoryOrder(catOrder);
  buildCategoryNav(orderedCats);

  root.innerHTML = orderedCats.map((cat, idx) => `
    <section
      class="menu-section"
      id="cat-${slugify(cat)}"
      style="animation-delay:${idx * 0.08}s"
    >
      <div class="section-header">
        <h2 class="section-title">${esc(cat)}</h2>
        <div class="section-line"></div>
        <span class="section-count">${byCat[cat].length} ${esc(t("productCountSuffix"))}</span>
      </div>
      <div class="cards-grid${gridLayoutClass()}">
        ${byCat[cat].map(it => cardHTML(it)).join("")}
      </div>
    </section>
  `).join("");

  root.querySelectorAll("img[data-src]").forEach(img => lazyLoad(img));
  initMasonryGrids(root);
}

function cardHTML(it) {
  const mode = _settings.displayMode || "mixed";
  if (mode === "photo") return cardHTMLPhoto(it);
  if (mode === "boxed") return cardHTMLBoxed(it);
  const showPhoto = it.showPhoto !== false; // alan yoksa (eski ürün) → fotoğraflı say
  return showPhoto ? cardHTMLPhoto(it) : cardHTMLBoxed(it);
}

function cardHTMLPhoto(it) {
  const imgInner = it.image
    ? `<img data-src="${esc(toCdnUrl(it.image))}" alt="${esc(it.name)}" loading="lazy">`
    : `<div class="prod-img-placeholder">☕</div>`;

  const badgeHTML = it.badge
    ? `<div class="prod-badge">${esc(it.badge)}</div>`
    : "";

  return `
    <div class="prod-card${it.active ? "" : " is-inactive"}" data-item='${jsonAttr(it)}' data-id="${esc(it.id)}">
      <div class="prod-img-wrap">
        ${badgeHTML}
        ${imgInner}
        <div class="prod-img-gradient"></div>
      </div>
      <div class="prod-body">
        <h3 class="prod-name">${esc(it.name)}</h3>
        ${tagsHTML(it.tags)}
        ${it.desc ? `<p class="prod-desc">${esc(it.desc)}</p>` : ""}
        ${extrasHTML(it.extras)}
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

/** Fotoğrafsız (Karma Mod) ürünler için "fine dining" kutucuk şablonu. */
function cardHTMLBoxed(it) {
  const badgeHTML = it.badge
    ? `<span class="prod-badge">${esc(it.badge)}</span>`
    : "";

  return `
    <div class="prod-card prod-card--boxed${it.active ? "" : " is-inactive"}" data-item='${jsonAttr(it)}' data-id="${esc(it.id)}">
      <div class="prod-body">
        <div class="boxed-card-top">
          <h3 class="prod-name">${esc(it.name)}</h3>
          ${badgeHTML}
        </div>
        ${tagsHTML(it.tags)}
        ${it.desc ? `<p class="prod-desc">${esc(it.desc)}</p>` : ""}
        ${extrasHTML(it.extras)}
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

// ─── ETİKETLER / EKSTRALAR — Görüntüleme Yardımcıları ────
/** Sabit etiket kayıt defteri: id → { tr, en } görünen metin çifti. */
const TAG_LABEL_TRANSLATIONS = {
  vegan:      { tr: "Vegan",      en: "Vegan" },
  vejetaryen: { tr: "Vejetaryen", en: "Vegetarian" },
  glutensiz:  { tr: "Glutensiz",  en: "Gluten-Free" },
  laktozsuz:  { tr: "Laktozsuz",  en: "Lactose-Free" },
  sekersiz:   { tr: "Şekersiz",   en: "Sugar-Free" },
  aci:        { tr: "Acı",        en: "Spicy" }
};

/** Bir etiket id'sini ("vegan" gibi) aktif dile göre görünen metne çevirir. */
function tagLabel(tagId) {
  const entry = TAG_LABEL_TRANSLATIONS[tagId];
  if (!entry) return tagId; // tanınmayan bir etiketse (eski veri vb.) olduğu gibi göster
  return entry[_currentLang] || entry.tr;
}

function tagsHTML(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return `
    <div class="prod-tags">
      ${tags.map(tagId => `<span class="prod-tag">${esc(tagLabel(tagId))}</span>`).join("")}
    </div>`;
}

function extrasHTML(extras) {
  if (!Array.isArray(extras) || !extras.length) return "";
  return `
    <ul class="prod-extras">
      ${extras.map(ex => `
        <li class="prod-extra-item">
          <span class="prod-extra-name">${esc(ex.name)}</span>
          <span class="prod-extra-price">+${esc(ex.price)}₺</span>
        </li>`).join("")}
    </ul>`;
}

/**
 * "Bunun Yanına İyi Gider" (çapraz satış / upsell) — admin panelde ürüne
 * bağlanan crossSellIds[] dizisindeki diğer ürünleri, hâlâ aktif olanlarla
 * sınırlı olarak, küçük ve tıklanabilir kartlar halinde üretir. Bir
 * referans silinmiş/pasif hale getirilmişse SESSİZCE atlanır — müşteri
 * asla kırık bir kart görmez. Öneri yoksa boş string döner (container
 * hiçbir yer kaplamaz, bkz. style.css → .lightbox-crosssell).
 */
function crossSellHTML(item) {
  if (!Array.isArray(item.crossSellIds) || !item.crossSellIds.length) return "";

  const linked = item.crossSellIds
    .map(id => _allItems.find(x => x.id === id))
    .filter(x => x && x.active && x.id !== item.id)
    .map(x => localizeItem(x, _currentLang));

  if (!linked.length) return "";

  return `
    <div class="lightbox-crosssell">
      <p class="lightbox-crosssell-title">${esc(t("crossSellTitle"))}</p>
      <div class="lightbox-crosssell-list">
        ${linked.map(x => `
          <div class="lightbox-crosssell-card" data-crosssell-id="${esc(x.id)}">
            <div class="lightbox-crosssell-img">
              ${x.image
                ? `<img src="${esc(toCdnUrl(x.image))}" alt="${esc(x.name)}">`
                : `<div class="lightbox-crosssell-placeholder">☕</div>`}
            </div>
            <span class="lightbox-crosssell-name">${esc(x.name)}</span>
            <span class="lightbox-crosssell-price">${esc(x.price)}₺</span>
          </div>
        `).join("")}
      </div>
    </div>`;
}

/** settings/general → categoryOrder dizisine göre kategori sırasını uygular
 * (scriptAdmin.js → applyCategoryOrder ile birebir aynı sözleşme, salt okunur). */
function applyCategoryOrder(catOrderFromItems) {
  const saved    = Array.isArray(_settings.categoryOrder) ? _settings.categoryOrder : [];
  const existing = new Set(catOrderFromItems);
  const ordered  = saved.filter(c => existing.has(c));
  catOrderFromItems.forEach(c => { if (!ordered.includes(c)) ordered.push(c); });
  return ordered;
}

// ─── CATEGORY TABS ───────────────────────────────────────
function buildCategoryNav(cats) {
  const nav = document.getElementById("cat-nav-inner");
  if (!nav) return;

  nav.innerHTML = cats.map((cat, i) => `
    <button
      class="cat-tab${i === 0 ? " active" : ""}"
      data-cat="${slugify(cat)}"
      data-cat-label="${esc(cat)}"
      type="button"
    >${esc(cat)}</button>
  `).join("");

  // Tıklama dinleyicisi YALNIZCA BİR KEZ bağlanır: #cat-nav-inner elemanının
  // kendisi her renderFull()/filterMenu() çağrısında SİLİNMEZ, sadece
  // innerHTML'i değişir — bu yüzden burada her seferinde yeni bir listener
  // eklemek (arama temizlendikçe, dil değiştikçe...) aynı tıklama için
  // katlanarak birikip her tıklamada N kere aynı kodu tekrar çalıştıran
  // sızıntılı listener'lara yol açardı.
  if (nav.dataset.bound !== "1") {
    nav.dataset.bound = "1";
    nav.addEventListener("click", e => {
      const btn = e.target.closest(".cat-tab");
      if (!btn) return;
      nav.querySelectorAll(".cat-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      scrollToSection(btn.dataset.cat);
    }, { passive: true });
  }

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

// ════════════════════════════════════════════════════════
//  SCROLL SPY (Otomatik Aktif Kategori Vurgusu)
// ════════════════════════════════════════════════════════
//
// ESKİ HATA: IntersectionObserver'ın rootMargin'i ("-160px 0px -60% 0px")
// sabit (hardcoded) bir 160px header yüksekliği varsayıyordu; oysa gerçek
// sticky yükseklik (header + arama çubuğu + kategori barı) promosyon/
// çevrimdışı banner'ı açılıp kapandıkça, dil değiştikçe ya da mobilde
// DEĞİŞKENDİR. Ayrıca rootMargin'in alt kenarı (-60%) geniş bir "görünürlük
// bandı" oluşturuyordu; kısa kategoriler bu bantta BİRDEN FAZLA section aynı
// anda "isIntersecting: true" olabiliyordu ve entries[] dizisinin işlenme
// sırası DOM sırasıyla garanti eşleşmediği için (tarayıcı bunu garanti etmez)
// yanlış (önceki) kategori aktif kalabiliyordu — "Tatlılar"dayken "Kahvaltı"
// sarı yanması tam olarak bu yüzdendi.
//
// YENİ YAKLAŞIM: Aktif kategori kararını IntersectionObserver'ın hangi
// entry'yi ne zaman ilettiğine BIRAKMIYORUZ. Bunun yerine, kullanıcının
// gözünün odaklandığı net bir "odak çizgisi" tanımlıyoruz (sticky barların
// hemen altı) ve her tetiklemede TÜM kategori section'larının GERÇEK anlık
// konumunu (getBoundingClientRect) tarayarak, bu çizgiyi en son geçmiş
// section'ı deterministik biçimde buluyoruz. Bu, section sırası belge
// sırasıyla birebir eşleştiği için asla yanlış (geçmişte kalan) bir
// kategoriyi aktif bırakmaz.
//
// Tetikleyici olarak passive "scroll"/"resize" + requestAnimationFrame
// throttling kullanılıyor: bu, ana thread'i bloklamadan (maksimum performans)
// her scroll frame'inde TEK bir hesaplama garantiler — IntersectionObserver'ın
// asenkron/gecikmeli ve sıra garantisi olmayan callback modelinin aksine.
let _scrollSpyCleanup = null; // önceki setupScrollSpy() çağrısının dinleyicilerini temizlemek için

function setupScrollSpy(cats) {
  // Menü her yeniden render edildiğinde (arama temizlendiğinde, dil
  // değiştiğinde, ürün güncellendiğinde vb.) ÖNCE eski dinleyicileri temizle
  // — aksi halde her render'da birikip performansı düşürür ve aynı anda
  // birden fazla scroll spy döngüsü çakışarak class toggle'ları çırpınmaya
  // (flicker) sebep olabilir.
  if (_scrollSpyCleanup) { _scrollSpyCleanup(); _scrollSpyCleanup = null; }

  const navInner = document.getElementById("cat-nav-inner");
  if (!navInner || !cats.length) return;

  const sections = cats
    .map(cat => ({ id: slugify(cat), el: document.getElementById(`cat-${slugify(cat)}`) }))
    .filter(s => s.el);
  if (!sections.length) return;

  let currentActiveId = null;
  let ticking = false;

  // Sticky elemanların (header + arama çubuğu + kategori barı) o anki GERÇEK
  // toplam yüksekliği — syncStickyOffsets() ile aynı mantık, burada ayrıca
  // ölçülür çünkü scroll spy tamamen bağımsız çalışabilmeli.
  function stickyOffset() {
    return (document.getElementById("site-header")?.offsetHeight || 0)
         + (document.getElementById("search-bar-wrap")?.offsetHeight || 0)
         + (document.getElementById("cat-nav")?.offsetHeight || 0);
  }

  function setActive(id) {
    if (!id || id === currentActiveId) return;
    currentActiveId = id;
    navInner.querySelectorAll(".cat-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.cat === id);
    });
    // Aktif sekmeyi #cat-nav-inner içindeki yatay kaydırmada ORTALA.
    navInner.querySelector(".cat-tab.active")
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  function recompute() {
    ticking = false;

    // Sayfanın en altına (overscroll/bounce dahil) gelindiyse, son kategori
    // henüz odak çizgisini "geçmemiş" olsa bile doğrudan onu aktif yap —
    // aksi halde kısa bir son kategoride kullanıcı en altta olsa bile bir
    // önceki kategori aktif görünmeye devam edebilir.
    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      setActive(sections[sections.length - 1].id);
      return;
    }

    // Odak çizgisi: sticky barların hemen altı + küçük bir tampon.
    const line = stickyOffset() + 2;

    // Section'lar DOM sırasıyla (yukarıdan aşağıya) birebir eşleşir; bu
    // çizgiyi en son geçmiş (rect.top <= line) section — kullanıcının o an
    // baktığı kategoridir. İlk aşamayan section'da döngüyü durdurmak yeterli
    // ve O(kategori sayısı) kadar ucuz bir işlemdir.
    let activeId = sections[0].id;
    for (const sec of sections) {
      if (sec.el.getBoundingClientRect().top <= line) activeId = sec.id;
      else break;
    }
    setActive(activeId);
  }

  function onScrollOrResize() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(recompute);
  }

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize, { passive: true });

  _scrollSpyCleanup = () => {
    window.removeEventListener("scroll", onScrollOrResize);
    window.removeEventListener("resize", onScrollOrResize);
  };

  recompute(); // ilk yükte / menü yeniden render edildiğinde doğru sekmeyi anında vurgula
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

  if (!query) {
    renderFull(_allItems);
    document.getElementById("cat-nav").style.display = "";
    return;
  }

  document.getElementById("cat-nav").style.display = "none";

  const q = normalize(query);

  // Hem Türkçe orijinal metinde HEM İngilizce çeviride arama yapılır — bu
  // sayede kullanıcı arayüzü TR görürken bile EN ürün adıyla arama yapabilir.
  const matched = _allItems
    .filter(it =>
      normalize(it.name).includes(q) ||
      normalize(it.category).includes(q) ||
      normalize(it.desc).includes(q) ||
      normalize(it.translations?.en?.name).includes(q) ||
      normalize(it.translations?.en?.desc).includes(q)
    )
    .map(it => localizeItem(it, _currentLang));

  if (!matched.length) {
    const msg = t("noSearchResult").replace("{query}", `<strong>${esc(query)}</strong>`);
    root.innerHTML = `<div class="search-no-result">${msg}</div>`;
    return;
  }

  root.innerHTML = `
    <section class="menu-section" style="animation-delay:0s">
      <div class="section-header">
        <h2 class="section-title">${esc(t("searchResultsTitle"))}</h2>
        <div class="section-line"></div>
        <span class="section-count">${matched.length} ${esc(t("productCountSuffix"))}</span>
      </div>
      <div class="cards-grid${gridLayoutClass()}">
        ${matched.map(it => cardHTML(it)).join("")}
      </div>
    </section>`;

  root.querySelectorAll("img[data-src]").forEach(img => lazyLoad(img));
  initMasonryGrids(root);
}

// ─── LIGHTBOX (yalnızca görüntüleme modu) ────────────────
function initLightbox() {
  const lb       = document.getElementById("lightbox");
  const backdrop = document.getElementById("lightbox-backdrop");
  const closeBtn = document.getElementById("lightbox-close");

  if (!lb) return;

  document.getElementById("menu-root").addEventListener("click", e => {
    const card = e.target.closest(".prod-card");
    if (!card) return;
    try {
      const item = JSON.parse(card.dataset.item || "{}");
      openLightboxView(item);
    } catch { /* parse hatası */ }
  });

  backdrop.addEventListener("click", closeLightbox);
  closeBtn.addEventListener("click", closeLightbox);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !lb.hidden) closeLightbox();
  });

  // "Bunun Yanına İyi Gider" kartına tıklanınca o ürünün lightbox'ı açılır
  // (mevcut görünümün üzerine yazılır). Container her openLightboxView()
  // çağrısında innerHTML ile yeniden üretildiği için dinleyici, silinmeyen
  // sabit bir üst elemana (#lightbox-view-mode) delege edilir.
  document.getElementById("lightbox-view-mode")?.addEventListener("click", e => {
    const card = e.target.closest("[data-crosssell-id]");
    if (!card) return;
    const raw = _allItems.find(x => x.id === card.dataset.crosssellId);
    if (!raw) return;
    openLightboxView(localizeItem(raw, _currentLang));
    document.querySelector(".lightbox-panel")?.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function openLightboxView(item) {
  const lb = document.getElementById("lightbox");
  lb.dataset.currentId = item.id || "";

  const imgWrap = document.getElementById("lightbox-img-wrap");
  if (item.image) {
    imgWrap.innerHTML = `
      <img src="${esc(toCdnUrl(item.image))}" alt="${esc(item.name)}">
      <div class="lightbox-img-gradient"></div>`;
    const img = imgWrap.querySelector("img");
    img.onload  = () => img.classList.add("loaded");
    img.onerror = () => {
      imgWrap.innerHTML = `<div class="lightbox-img-placeholder">☕</div>`;
    };
  } else {
    imgWrap.innerHTML = `<div class="lightbox-img-placeholder">☕</div>`;
  }

  const badgeLine = document.getElementById("lightbox-badge-line");
  badgeLine.innerHTML = item.badge
    ? `<span class="lightbox-badge">${esc(item.badge)}</span>`
    : "";

  document.getElementById("lightbox-name").textContent  = item.name;
  document.getElementById("lightbox-tags").innerHTML    = tagsHTML(item.tags);
  document.getElementById("lightbox-desc").textContent  = item.desc;
  document.getElementById("lightbox-extras").innerHTML  = extrasHTML(item.extras);
  document.getElementById("lightbox-price").textContent = item.price;

  const crossSellEl = document.getElementById("lightbox-crosssell");
  if (crossSellEl) crossSellEl.innerHTML = crossSellHTML(item);

  lb.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.hidden = true;
  document.body.style.overflow = "";
}

// ─── HERO SLIDER ─────────────────────────────────────────
let _sliderIndex  = 0;
let _sliderTimer  = null;
let _sliderSlides = [];
let _sliderData   = [];

function initHeroSlider(mediaList) {
  clearTimeout(_sliderTimer);
  const container = document.getElementById("hero-slider");
  const dotsEl    = document.getElementById("hero-dots");
  if (!container || !dotsEl) return;

  container.innerHTML = "";
  dotsEl.innerHTML    = "";
  _sliderSlides       = [];
  _sliderIndex        = 0;

  const list = Array.isArray(mediaList) ? mediaList : [];

  if (list.length === 0) return;

  _sliderData = list;

  list.forEach((item, i) => {
    // HİBRİT SLIDER: item.type === "video" ise <video>, aksi halde (mevcut
    // davranış) <img> üretilir. toCdnUrl(), "images/cilve3.mp4" gibi yerel/
    // relative bir yola DOKUNMAZ — new URL() bunu mutlak bir adres olarak
    // parse edemediği için catch bloğuna düşer ve string olduğu gibi
    // döndürülür; sadece gerçek Firebase Storage linkleri CDN'e yönlendirilir.
    let el;
    if (item.type === "video") {
      el = document.createElement("video");
      el.src         = toCdnUrl(item.url);
      el.autoplay    = true;
      el.loop        = true;
      el.muted       = true;
      el.playsInline = true;
    } else {
      el = document.createElement("img");
      el.src = toCdnUrl(item.url);
      el.alt = "";
    }
    el.className = "hero-slide"; // Ken Burns / is-active / is-leaving class'ları img ile video'da birebir aynı şekilde çalışır
    container.appendChild(el);
    _sliderSlides.push(el);

    if (list.length > 1) {
      const dot = document.createElement("span");
      dot.className = "hero-dot" + (i === 0 ? " is-active" : "");
      dotsEl.appendChild(dot);
    }
  });

  dotsEl.hidden = list.length <= 1;
  _showSlide(0);
}

function _updateDots(index) {
  const dots = document.querySelectorAll(".hero-dot");
  dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
}

function _showSlide(index) {
  const list   = _sliderData;
  const slides = _sliderSlides;
  if (!slides.length) return;

  clearTimeout(_sliderTimer);

  slides.forEach((s, i) => {
    if (i === _sliderIndex && i !== index) {
      s.classList.remove("is-active");
      s.classList.add("is-leaving");
      setTimeout(() => s.classList.remove("is-leaving"), 900);
    }
  });

  _sliderIndex = index;
  _updateDots(index);

  const current = slides[index];
  const item    = list[index];

  current.classList.add("is-active");

  // ── Dinamik metin güncellemesi ──
  const textBlock = document.querySelector(".hero-text-block");
  const eyebrowEl = document.getElementById("hero-eyebrow");
  const titleEl   = document.getElementById("hero-title");
  const subEl     = document.getElementById("hero-sub");

  if (textBlock && eyebrowEl && titleEl && subEl) {
    textBlock.style.animation = "none";
    void textBlock.offsetWidth;
    textBlock.style.animation = "hero-text-in 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards";

    eyebrowEl.textContent = item.eyebrow || "";
    titleEl.innerHTML = `${esc(item.title || "")}<br><em id="hero-title-em">${esc(item.titleEm || "")}</em>`;
    subEl.textContent = item.sub || "";

    // Eyebrow + title + sub üçü de boşsa, ortada asılı kalan ◆ noktasını gizle
    const dividerEl = document.querySelector(".hero-divider");
    if (dividerEl) {
      const isTextEmpty = !item.eyebrow && !item.title && !item.sub;
      dividerEl.classList.toggle("is-hidden", isTextEmpty);
    }

    // ── Hero CTA Butonu (reklam/tanıtım linki) ──
    const ctaBtn  = document.getElementById("hero-cta-btn");
    const ctaText = document.getElementById("hero-cta-text");
    if (ctaBtn && ctaText) {
      const link = str(item.ctaLink);
      if (link) {
        ctaText.textContent = str(item.ctaText) || t("heroCtaDefaultLabel");
        ctaBtn.href = ensureHttpsUrl(link);
        ctaBtn.hidden = false;
      } else {
        ctaBtn.hidden = true;
      }
    }
  }

  // Fotoğraf Ken Burns ile ekranda kalır; süre dolunca bir sonraki slayta geçilir
  const duration = item.duration || 5000;
  if (list.length > 1) {
    _sliderTimer = setTimeout(() => _nextSlide(), duration);
  }
}

function _nextSlide() {
  const next = (_sliderIndex + 1) % _sliderData.length;
  _showSlide(next);
}

// ─── TOAST ────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isError = false) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerHTML = `<span class="toast-dot"></span><span>${esc(msg)}</span>`;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => { toast.hidden = true; }, 250);
  }, 2600);
}

// ─── SCROLL TO TOP ───────────────────────────────────────
function initScrollTop() {
  const btn = document.getElementById("scroll-top-btn");
  if (!btn) return;

  window.addEventListener("scroll", () => {
    btn.classList.toggle("visible", window.scrollY > 400);
    btn.hidden = false;
  }, { passive: true });

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ─── LOADING / ERROR ─────────────────────────────────────
function showLoading() {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `<div class="skeleton-grid" aria-hidden="true">${skeletonCardsHTML(6)}</div>`;
}

/** N adet iskelet kart HTML'i üretir (gerçek .prod-card ile aynı boyutlarda). */
function skeletonCardsHTML(count) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-desc"></div>
        <div class="skeleton-line skeleton-line-desc2"></div>
        <div class="skeleton-line skeleton-line-price"></div>
      </div>
    </div>`;
  return card.repeat(count);
}

function showError(msg) {
  const root = document.getElementById("menu-root");
  if (!root) return;
  root.innerHTML = `
    <div class="lux-error">
      ${esc(msg)}
      <div class="lux-error-sub">${esc(t("reloadHint"))}</div>
    </div>`;
}

/**
 * Kafe ID yoksa veya Storage'dan 404/403 gelirse sayfanın tamamını kaplar.
 * Markup index.html içinde #fatal-error-overlay olarak zaten hazır (hidden);
 * burada sadece başlık/açıklama metinleri doldurulup görünür hale getiriliyor.
 * Bu sayede tema (siyah/gold) ile birebir uyumlu, tek bir CSS kaynağından
 * (style.css → .fatal-error-*) yönetilen bir ekran elde ediyoruz.
 */
function showFatalError(title, detail) {
  // Önce mevcut spinner/menü içeriğini temizle
  const root = document.getElementById("menu-root");
  if (root) root.innerHTML = "";

  const overlay = document.getElementById("fatal-error-overlay");
  if (!overlay) return;

  const titleEl  = document.getElementById("fatal-error-title");
  const detailEl = document.getElementById("fatal-error-detail");
  if (titleEl)  titleEl.textContent  = title;
  if (detailEl) detailEl.textContent = detail;

  overlay.hidden = false;
}

// ─── TOUCH CARDS (mobil gold glow) ───────────────────────
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

// ─── UTILS ───────────────────────────────────────────────
function str(v) { return String(v ?? "").trim(); }

function esc(s) {
  return String(s ?? "")
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

/**
 * Firestore/JSON'dan gelen "translations" objesini güvenli, öngörülebilir
 * bir şekle normalize eder: { en: { name: "", desc: "" } }. Eksik/bozuk/
 * undefined girdilerde boş string'lerle dolu bir iskelet döner — böylece
 * localizeItem() hiçbir zaman "Cannot read properties of undefined" hatası
 * almaz (scriptAdmin.js'teki aynı isimli fonksiyonla birebir aynı sözleşme).
 */
function normalizeTranslations(tr) {
  const en = (tr && typeof tr === "object" && tr.en && typeof tr.en === "object") ? tr.en : {};
  return { en: { name: str(en.name), desc: str(en.desc) } };
}

/**
 * Bir ürünü verilen dile göre çözümler: EN seçiliyse ve çeviri girilmişse
 * translations.en.{name,desc} kullanılır; TR seçiliyse veya çeviri boşsa
 * (admin doldurmadıysa) orijinal Türkçe alanlara SESSİZCE geri düşülür —
 * müşteri hiçbir zaman boş bir ürün adı/açıklaması görmez. Kategori, fiyat,
 * etiket ve ekstralar bu çeviri kapsamının DIŞINDADIR (bkz. proje isterleri).
 */
function localizeItem(item, lang) {
  if (!item || lang === "tr") return item;
  const en = item.translations?.en;
  if (!en) return item;
  return {
    ...item,
    name: en.name || item.name,
    desc: en.desc || item.desc
  };
}

function jsonAttr(obj) {
  return JSON.stringify(obj).replace(/'/g, "&#039;");
}

/**
 * Instagram URL'sinden kullanıcı adını türetir.
 * Örn: "https://instagram.com/hankafem/" → "hankafem"
 *      "https://www.instagram.com/han.kafem?hl=tr" → "han.kafem"
 * Parse edilemezse boş string döner (mevcut statik metin korunur).
 */
function igUsernameFromLink(url) {
  if (!url) return "";
  try {
    const clean = String(url).trim().replace(/\/+$/, "");
    const lastSegment = clean.split("/").pop() || "";
    return lastSegment.split("?")[0].replace(/^@/, "");
  } catch {
    return "";
  }
}