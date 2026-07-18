// ════════════════════════════════════════════════════════
//  HAN KAFEM — Müşteri Vitrini Service Worker
//  Offline-first PWA desteği. Firebase SDK bağımlılığı SIFIR
//  (app.js'in "maksimum performans, minimum bağımlılık" felsefesiyle
//  birebir tutarlı — burada da hiçbir harici kütüphane kullanılmaz).
// ════════════════════════════════════════════════════════
//
// ÖNEMLİ KURULUM NOTU: Bu dosya (sw.js), index.html ile TAM OLARAK AYNI
// klasörde (proje kökünde) durmalıdır. Service Worker'ın "scope"u,
// kaydedildiği dizine göre belirlenir (bkz. app.js → registerServiceWorker,
// { scope: "./" } ile kayıt ediliyor) — sw.js başka bir alt klasörde
// olursa index.html'i ve public_menus isteklerini YAKALAYAMAZ.
//
// SÜRÜMLEME: Statik dosyalardan (style.css, app.js vb.) herhangi birini
// güncellediğinizde SW_VERSION değerini artırın. Aksi halde tarayıcılar,
// eski dosyaları önbellekten sunmaya devam edebilir (activate event'i eski
// cache'leri temizler, ama bu YALNIZCA versiyon değiştiğinde tetiklenir).

const SW_VERSION = "v2";
const STATIC_CACHE = `hankafem-static-${SW_VERSION}`;
const MENU_CACHE    = `hankafem-menu-${SW_VERSION}`;

// "Uygulama kabuğu" — ilk ziyarette önbelleğe alınacak temel statik
// dosyalar. Menü verisi (JSON) BURAYA DAHİL DEĞİLDİR; o ayrı bir stratejiyle
// (Stale-While-Revalidate) fetch anında önbelleğe alınır (bkz. aşağıda).
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./hankafemlogo.png"
];

// ─── INSTALL: Uygulama kabuğunu önbelleğe al ─────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // yeni SW'nin beklemeden aktif olmasını sağlar
      .catch(err => {
        // addAll() bir dosyayı bile çekemezse TÜM install başarısız olur —
        // bu yüzden hatayı logluyoruz ama fırlatmıyoruz; SW yine de kurulur,
        // sadece o dosya(lar) ilk ziyarette önbelleğe alınamamış olur.
        console.warn("[HanKafem][SW] App shell önbelleklemesi kısmen başarısız:", err);
      })
  );
});

// ─── ACTIVATE: Eski sürüm önbelleklerini temizle ─────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== MENU_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // açık sekmeleri de hemen bu SW'ye bağlar
  );
});

// ─── FETCH: İsteği türüne göre doğru stratejiye yönlendir ─
self.addEventListener("fetch", event => {
  const req = event.request;

  // Sadece GET isteklerini ele alıyoruz. Analitik Tracker'ın attığı POST
  // istekleri (Firestore REST API) veya başka herhangi bir yazma isteği
  // BURAYA HİÇ UĞRAMADAN doğrudan ağa gider — asla önbelleklenmez veya
  // geciktirilmez.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return; // geçersiz URL — tarayıcının varsayılan davranışına bırak
  }

  // http/https dışı şemaları (chrome-extension:// vb.) hiç ele almıyoruz.
  if (!url.protocol.startsWith("http")) return;

  // 1) MENÜ JSON'U (Firebase Storage — URL'sinde "public_menus" geçen
  //    istekler) → STALE-WHILE-REVALIDATE.
  //    Önbellekte varsa ANINDA onu döndürür (kullanıcı beklemez), arka
  //    planda ağdan tazesini çekip önbelleği günceller. İnternet TAMAMEN
  //    koparsa bile kullanıcı son indirdiği menüyü sorunsuz görebilir —
  //    CQRS mimarisinin "public_menus/{kafe_id}.json" snapshot'ı zaten bu
  //    senaryo için tasarlanmıştı, SW onu çevrimdışı erişilebilir kılıyor.
  if (url.href.includes("public_menus")) {
    event.respondWith(staleWhileRevalidate(req, MENU_CACHE));
    return;
  }

  // 2) UYGULAMA KABUĞU (HTML/CSS/JS/manifest/logo ve benzeri statik
  //    varlıklar) → NETWORK FIRST, olmazsa CACHE'e düş.
  //    Böylece yeni bir deploy sonrası her zaman en güncel sürüm öncelikli
  //    olur; ağ yoksa (veya çok yavaşsa/hata verirse) kullanıcı son bilinen
  //    çalışan sürümü görmeye devam eder — beyaz ekran YOK.
  event.respondWith(networkFirstFallingBackToCache(req, STATIC_CACHE));
});

/**
 * Stale-While-Revalidate: önbellekteki kopyayı ANINDA döndürür (varsa),
 * eşzamanlı olarak ağdan tazesini çekip önbelleği günceller. Ağ isteği
 * başarısız olursa (offline) sessizce yutulur — zaten önbellekteki cevap
 * kullanıcıya gitmiş olur.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      // Sadece başarılı (2xx) cevapları önbelleğe yaz — hata sayfalarını
      // veya kısmi/opak cevapları ASLA önbelleğe kalıcı olarak yazmayız.
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null); // ağ hatası (offline) — sorun değil, aşağıda ele alınır

  if (cached) {
    // Önbellek varsa onu HEMEN döndür; ağ isteği arka planda devam eder
    // (yanıtını beklemeye gerek yok, "fire-and-forget" güncelleme).
    return cached;
  }

  // Önbellekte hiçbir şey yoksa (ilk ziyaret), ağ cevabını beklemek
  // ZORUNDAYIZ — dönecek başka bir şey yok.
  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  // Hem önbellek hem ağ başarısızsa: kullanıcıya jenerik bir çevrimdışı
  // JSON cevabı döndürüyoruz (app.js'teki fetchMenuData bunu normal bir
  // HTTP hatası gibi yakalayıp kendi hata ekranını gösterecektir).
  return new Response(
    JSON.stringify({ error: "offline", message: "Menü verisi ne önbellekte ne de ağda bulunamadı." }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Network First, falling back to cache: önce ağdan çekmeyi dener (her
 * zaman en güncel sürüm önceliklidir); ağ başarısız olursa (offline veya
 * hata) önbellekteki son bilinen kopyaya düşer. Navigasyon (sayfa) istekleri
 * için önbellekte de hiçbir şey yoksa, en azından app shell'in index.html'ini
 * döndürerek boş beyaz ekran yerine çalışan bir arayüz gösterir.
 */
async function networkFirstFallingBackToCache(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    // ÖNEMLİ — 206 PARTIAL CONTENT DÜZELTMESİ:
    // response.ok, HTTP 200-299 arasındaki HER durum kodu için true döner —
    // bu da 206 (Partial Content) için de geçerlidir. <video> etiketleri
    // tarayıcı tarafından "Range" header'ı ile (dosyanın tamamı yerine belirli
    // byte aralığı) istenir ve sunucu buna 206 ile cevap verir. Cache API'nin
    // put() metodu ise KISMİ (206) yanıtları kabul etmez ve "Failed to
    // execute 'put' on 'Cache': Partial response (status code 206) is
    // unsupported" hatasıyla patlar.
    //
    // Bu yüzden SADECE tam (status === 200) VE Range isteği OLMAYAN
    // yanıtları önbelleğe yazıyoruz. Range istekleri / 206 yanıtları normal
    // şekilde tarayıcıya döner, sadece önbelleğe alınmaz — video her zaman
    // ağdan akıtılır (offline modda video oynamayabilir, ama bu, menü verisi
    // ve statik kabuğun offline çalışması gereken asıl önceliğimizi bozmaz).
    const isRangeRequest = request.headers.has("range");
    if (response && response.status === 200 && !isRangeRequest) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    // "ignoreSearch: true" → "./index.html?kafe=ABC123" isteği, önbellekte
    // sorgu parametresiz kaydedilmiş "./index.html" girdisiyle EŞLEŞİR.
    // Multi-tenant mimaride bu KRİTİKTİR: her kafenin URL'si farklı ?kafe=
    // değeri taşır ama app shell dosyası (index.html) hepsi için AYNIDIR.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (request.mode === "navigate") {
      const shellFallback = await cache.match("./index.html");
      if (shellFallback) return shellFallback;
    }

    return new Response(
      "Çevrimdışısınız ve bu içerik daha önce önbelleğe alınmamış.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
