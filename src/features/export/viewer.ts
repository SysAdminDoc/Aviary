import { serializeExportRecords } from "./assets";
import type { ExportRecord } from "./types";

const VIEWER_LABELS = {
  en: {
    name: "English",
    title: "Aviary archive",
    subtitle: "Local archive viewer — remote references are never fetched automatically.",
    language: "Language",
    search: "Search records",
    status: "Media status",
    all: "All media",
    captured: "Captured bytes",
    remote: "Remote reference",
    missing: "Missing",
    sort: "Sort",
    newest: "Newest first",
    oldest: "Oldest first",
    handle: "Handle",
    thread: "Thread view",
    media: "Media",
    records: "records",
    shown: "shown",
    noResults: "No matching records.",
    source: "source",
    bytes: "bytes",
    checksum: "SHA-256",
    openSource: "Open source URL",
    threadPosts: "posts",
    offline: "offline-ready",
    network: "network may be required"
  },
  es: {
    name: "Español",
    title: "Archivo de Aviary",
    subtitle: "Visor de archivo local — las referencias remotas nunca se descargan automáticamente.",
    language: "Idioma",
    search: "Buscar registros",
    status: "Estado multimedia",
    all: "Todo el contenido",
    captured: "Bytes capturados",
    remote: "Referencia remota",
    missing: "Faltante",
    sort: "Ordenar",
    newest: "Más recientes primero",
    oldest: "Más antiguos primero",
    handle: "Usuario",
    thread: "Vista de hilos",
    media: "Contenido multimedia",
    records: "registros",
    shown: "mostrados",
    noResults: "No hay registros coincidentes.",
    source: "origen",
    bytes: "bytes",
    checksum: "SHA-256",
    openSource: "Abrir URL de origen",
    threadPosts: "publicaciones",
    offline: "listo sin conexión",
    network: "puede requerir red"
  },
  pt: {
    name: "Português",
    title: "Arquivo Aviary",
    subtitle: "Visualizador de arquivo local — referências remotas nunca são buscadas automaticamente.",
    language: "Idioma",
    search: "Pesquisar registros",
    status: "Status da mídia",
    all: "Todas as mídias",
    captured: "Bytes capturados",
    remote: "Referência remota",
    missing: "Ausente",
    sort: "Ordenar",
    newest: "Mais recentes primeiro",
    oldest: "Mais antigas primeiro",
    handle: "Usuário",
    thread: "Visualização de tópicos",
    media: "Mídia",
    records: "registros",
    shown: "exibidos",
    noResults: "Nenhum registro correspondente.",
    source: "origem",
    bytes: "bytes",
    checksum: "SHA-256",
    openSource: "Abrir URL de origem",
    threadPosts: "publicações",
    offline: "pronto off-line",
    network: "a rede pode ser necessária"
  },
  fr: {
    name: "Français",
    title: "Archive Aviary",
    subtitle: "Lecteur d’archive local — les références distantes ne sont jamais récupérées automatiquement.",
    language: "Langue",
    search: "Rechercher des entrées",
    status: "État des médias",
    all: "Tous les médias",
    captured: "Octets capturés",
    remote: "Référence distante",
    missing: "Manquant",
    sort: "Trier",
    newest: "Plus récent d’abord",
    oldest: "Plus ancien d’abord",
    handle: "Compte",
    thread: "Vue des fils",
    media: "Médias",
    records: "entrées",
    shown: "affichées",
    noResults: "Aucune entrée correspondante.",
    source: "source",
    bytes: "octets",
    checksum: "SHA-256",
    openSource: "Ouvrir l’URL source",
    threadPosts: "publications",
    offline: "prêt hors ligne",
    network: "réseau potentiellement nécessaire"
  },
  de: {
    name: "Deutsch",
    title: "Aviary-Archiv",
    subtitle: "Lokaler Archiv-Viewer — Remote-Referenzen werden niemals automatisch abgerufen.",
    language: "Sprache",
    search: "Einträge durchsuchen",
    status: "Medienstatus",
    all: "Alle Medien",
    captured: "Erfasste Bytes",
    remote: "Remote-Referenz",
    missing: "Fehlt",
    sort: "Sortieren",
    newest: "Neueste zuerst",
    oldest: "Älteste zuerst",
    handle: "Handle",
    thread: "Thread-Ansicht",
    media: "Medien",
    records: "Einträge",
    shown: "angezeigt",
    noResults: "Keine passenden Einträge.",
    source: "Quelle",
    bytes: "Bytes",
    checksum: "SHA-256",
    openSource: "Quell-URL öffnen",
    threadPosts: "Beiträge",
    offline: "offline-fertig",
    network: "Netzwerk eventuell erforderlich"
  },
  ja: {
    name: "日本語",
    title: "Aviary アーカイブ",
    subtitle: "ローカルアーカイブビューアー — リモート参照は自動取得されません。",
    language: "言語",
    search: "レコードを検索",
    status: "メディア状態",
    all: "すべてのメディア",
    captured: "キャプチャ済みバイト",
    remote: "リモート参照",
    missing: "欠落",
    sort: "並べ替え",
    newest: "新しい順",
    oldest: "古い順",
    handle: "ハンドル",
    thread: "スレッド表示",
    media: "メディア",
    records: "件",
    shown: "表示",
    noResults: "一致するレコードはありません。",
    source: "ソース",
    bytes: "バイト",
    checksum: "SHA-256",
    openSource: "ソースURLを開く",
    threadPosts: "件の投稿",
    offline: "オフライン対応",
    network: "ネットワークが必要な場合があります"
  },
  ko: {
    name: "한국어",
    title: "Aviary 아카이브",
    subtitle: "로컬 아카이브 뷰어 — 원격 참조를 자동으로 가져오지 않습니다.",
    language: "언어",
    search: "레코드 검색",
    status: "미디어 상태",
    all: "모든 미디어",
    captured: "캡처된 바이트",
    remote: "원격 참조",
    missing: "누락됨",
    sort: "정렬",
    newest: "최신순",
    oldest: "오래된 순",
    handle: "핸들",
    thread: "스레드 보기",
    media: "미디어",
    records: "개 레코드",
    shown: "표시됨",
    noResults: "일치하는 레코드가 없습니다.",
    source: "출처",
    bytes: "바이트",
    checksum: "SHA-256",
    openSource: "출처 URL 열기",
    threadPosts: "개 게시물",
    offline: "오프라인 준비됨",
    network: "네트워크가 필요할 수 있음"
  },
  ar: {
    name: "العربية",
    title: "أرشيف Aviary",
    subtitle: "عارض أرشيف محلي — لا يتم جلب المراجع البعيدة تلقائياً.",
    language: "اللغة",
    search: "البحث في السجلات",
    status: "حالة الوسائط",
    all: "كل الوسائط",
    captured: "البايتات الملتقطة",
    remote: "مرجع بعيد",
    missing: "مفقود",
    sort: "الترتيب",
    newest: "الأحدث أولاً",
    oldest: "الأقدم أولاً",
    handle: "المعرّف",
    thread: "عرض سلاسل المحادثة",
    media: "الوسائط",
    records: "سجلات",
    shown: "معروضة",
    noResults: "لا توجد سجلات مطابقة.",
    source: "المصدر",
    bytes: "بايت",
    checksum: "SHA-256",
    openSource: "فتح عنوان المصدر",
    threadPosts: "منشورات",
    offline: "جاهز للعمل دون اتصال",
    network: "قد تتطلب الشبكة"
  },
  he: {
    name: "עברית",
    title: "ארכיון Aviary",
    subtitle: "מציג ארכיון מקומי — הפניות מרוחקות לעולם לא נטענות אוטומטית.",
    language: "שפה",
    search: "חיפוש רשומות",
    status: "מצב מדיה",
    all: "כל המדיה",
    captured: "בתים שנלכדו",
    remote: "הפניה מרוחקת",
    missing: "חסר",
    sort: "מיון",
    newest: "החדשות תחילה",
    oldest: "הישנות תחילה",
    handle: "מזהה",
    thread: "תצוגת שרשורים",
    media: "מדיה",
    records: "רשומות",
    shown: "מוצגות",
    noResults: "אין רשומות תואמות.",
    source: "מקור",
    bytes: "בתים",
    checksum: "SHA-256",
    openSource: "פתיחת כתובת המקור",
    threadPosts: "פוסטים",
    offline: "מוכן ללא חיבור",
    network: "ייתכן שנדרש חיבור רשת"
  }
} as const;

type ViewerLocale = keyof typeof VIEWER_LABELS;
type ViewerLabels = (typeof VIEWER_LABELS)[ViewerLocale];

const LOCALE_ORDER: ViewerLocale[] = ["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"];

export function buildExportViewer(records: readonly ExportRecord[]): Uint8Array {
  const data = safeJson(serializeExportRecords(records));
  const labels = safeJson(VIEWER_LABELS);
  const script = viewerScript(labels);
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Aviary archive</title>
<style>${VIEWER_STYLES}</style>
</head><body>
<main id="app">
  <header class="hero">
    <div><h1 id="title">Aviary archive</h1><p id="subtitle"></p></div>
    <label class="locale"><span id="language-label">Language</span><select id="locale"></select></label>
  </header>
  <section class="toolbar" aria-labelledby="search-label">
    <label><span id="search-label">Search records</span><input id="search" type="search" autocomplete="off" /></label>
    <label><span id="status-label">Media status</span><select id="status"></select></label>
    <label><span id="sort-label">Sort</span><select id="sort"></select></label>
    <label class="check"><input id="thread" type="checkbox" /><span id="thread-label">Thread view</span></label>
  </section>
  <p id="summary" class="summary" role="status"></p>
  <p id="empty" class="empty" hidden></p>
  <div id="records" class="records" role="region" aria-live="polite" aria-label="Aviary records">
    <div id="canvas" class="canvas"><div id="top-spacer"></div><div id="list"></div><div id="bottom-spacer"></div></div>
  </div>
</main>
<script type="application/json" id="records-data">${data}</script>
<script>${script}</script>
</body></html>`;
  return new TextEncoder().encode(html);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function viewerScript(labels: string): string {
  return `(function () {
  "use strict";
  const LABELS = ${labels};
  const RECORDS = JSON.parse(document.getElementById("records-data").textContent || "[]");
  const LOCALES = ["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"];
  const RTL = new Set(["ar", "he"]);
  const state = { locale: localeFromBrowser(), query: "", status: "all", sort: "newest", thread: false };
  const rowHeight = 190;
  const overscan = 4;
  const viewport = document.getElementById("records");
  const list = document.getElementById("list");
  const topSpacer = document.getElementById("top-spacer");
  const bottomSpacer = document.getElementById("bottom-spacer");
  const empty = document.getElementById("empty");
  const summary = document.getElementById("summary");
  const queryInput = document.getElementById("search");
  const statusSelect = document.getElementById("status");
  const sortSelect = document.getElementById("sort");
  const threadInput = document.getElementById("thread");
  const localeSelect = document.getElementById("locale");
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const currentLabels = () => LABELS[state.locale] || LABELS.en;
  const interpolate = (value, replacements) => Object.entries(replacements).reduce(
    (result, entry) => result.replaceAll("{" + entry[0] + "}", String(entry[1])), value
  );
  const captureOf = (media) => media && media.capture ? media.capture : {
    status: media && media.url ? "remote-reference" : "missing",
    sourceUrl: media && media.url ? media.url : "",
    capturedAt: null,
    byteLength: null,
    sha256: null,
    retryable: Boolean(media && media.url)
  };
  const statusLabel = (status) => {
    const labels = currentLabels();
    return status === "captured-bytes" ? labels.captured : status === "remote-reference" ? labels.remote : labels.missing;
  };
  const mediaStatuses = (record) => new Set((record.media || []).map((media) => captureOf(media).status));
  const recordText = (record) => [record.handle, record.displayName, record.text, record.permalink]
    .filter(Boolean).join(" ").toLocaleLowerCase();
  function localeFromBrowser() {
    const candidate = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LOCALES.includes(candidate) ? candidate : "en";
  }
  function populateSelect(select, options, selected) {
    clear(select);
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option[0];
      item.textContent = option[1];
      item.selected = option[0] === selected;
      select.append(item);
    });
  }
  function applyLabels() {
    const labels = currentLabels();
    document.documentElement.lang = state.locale;
    document.documentElement.dir = RTL.has(state.locale) ? "rtl" : "ltr";
    document.title = labels.title;
    document.getElementById("title").textContent = labels.title;
    document.getElementById("subtitle").textContent = labels.subtitle;
    document.getElementById("language-label").textContent = labels.language;
    document.getElementById("search-label").textContent = labels.search;
    document.getElementById("status-label").textContent = labels.status;
    document.getElementById("sort-label").textContent = labels.sort;
    document.getElementById("thread-label").textContent = labels.thread;
    queryInput.setAttribute("aria-label", labels.search);
    statusSelect.setAttribute("aria-label", labels.status);
    sortSelect.setAttribute("aria-label", labels.sort);
    threadInput.setAttribute("aria-label", labels.thread);
    populateSelect(localeSelect, LOCALES.map((code) => [code, LABELS[code].name]), state.locale);
    populateSelect(statusSelect, [["all", labels.all], ["captured-bytes", labels.captured], ["remote-reference", labels.remote], ["missing", labels.missing]], state.status);
    populateSelect(sortSelect, [["newest", labels.newest], ["oldest", labels.oldest], ["handle", labels.handle]], state.sort);
    render();
  }
  function filteredRecords() {
    const query = state.query.trim().toLocaleLowerCase();
    const filtered = RECORDS.filter((record) => {
      if (query && !recordText(record).includes(query)) return false;
      if (state.status !== "all" && !mediaStatuses(record).has(state.status)) return false;
      return true;
    });
    filtered.sort((left, right) => {
      if (state.sort === "handle") return String(left.handle || "").localeCompare(String(right.handle || ""));
      const leftDate = Date.parse(left.capturedAt || "") || 0;
      const rightDate = Date.parse(right.capturedAt || "") || 0;
      return state.sort === "newest" ? rightDate - leftDate : leftDate - rightDate;
    });
    return state.thread ? threadGroups(filtered) : filtered.map((record) => [record]);
  }
  function threadGroups(records) {
    const groups = new Map();
    records.forEach((record) => {
      const key = record.conversationId || record.threadId || (record.handle ? "handle:" + record.handle : "record:" + (record.tweetId || "unknown"));
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    });
    return Array.from(groups.values());
  }
  function appendMedia(card, group) {
    const labels = currentLabels();
    const media = group.flatMap((record) => record.media || []);
    if (media.length === 0) return;
    const section = document.createElement("section");
    section.className = "media";
    section.append(text("h3", labels.media));
    media.slice(0, 24).forEach((entry) => {
      const capture = captureOf(entry);
      const item = document.createElement("div");
      item.className = "media-item status-" + capture.status;
      item.append(text("strong", entry.kind + " — " + statusLabel(capture.status)));
      if (capture.status === "captured-bytes" && capture.packagePath && /^(?:[a-z0-9._-]+\\/)*[a-z0-9._/-]+$/i.test(capture.packagePath)) {
        if (/^image\\//i.test(entry.type || "")) {
          const image = document.createElement("img");
          image.src = capture.packagePath;
          image.loading = "lazy";
          image.alt = entry.altText || entry.kind;
          item.append(image);
        }
        const link = document.createElement("a");
        link.href = capture.packagePath;
        link.textContent = labels.captured;
        item.append(link);
      } else if (capture.status === "remote-reference" && /^https?:\\/\\//i.test(capture.sourceUrl || "")) {
        const link = document.createElement("a");
        link.href = capture.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = labels.openSource;
        item.append(link);
      } else {
        item.append(text("span", labels.missing));
      }
      const details = [
        capture.capturedAt || "",
        capture.byteLength === null || capture.byteLength === undefined ? "" : capture.byteLength + " " + labels.bytes,
        capture.sha256 ? labels.checksum + " " + capture.sha256 : ""
      ].filter(Boolean).join(" · ");
      if (details) item.append(text("small", details));
      if (capture.status === "remote-reference" && capture.sourceUrl) item.append(text("small", labels.source + ": " + capture.sourceUrl, "source"));
      section.append(item);
    });
    if (media.length > 24) section.append(text("small", "+" + (media.length - 24) + " " + labels.media));
    card.append(section);
  }
  function appendCard(group) {
    const record = group[0];
    const card = document.createElement("article");
    card.className = "record-card";
    const heading = document.createElement("div");
    heading.className = "record-heading";
    heading.append(text("h2", record.displayName || (record.handle ? "@" + record.handle : "Unknown")));
    if (record.handle) heading.append(text("span", "@" + record.handle, "handle"));
    if (group.length > 1) heading.append(text("span", group.length + " " + currentLabels().threadPosts, "thread-count"));
    heading.append(text("time", record.capturedAt || "", "date"));
    card.append(heading);
    group.slice(0, 12).forEach((entry) => {
      const body = text("p", entry.text || "", "body");
      card.append(body);
    });
    if (group.length > 12) card.append(text("p", "+" + (group.length - 12) + " " + currentLabels().threadPosts));
    appendMedia(card, group);
    if (record.permalink && /^https?:\\/\\//i.test(record.permalink)) {
      const link = document.createElement("a");
      link.href = record.permalink;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = record.permalink;
      card.append(link);
    }
    return card;
  }
  function render() {
    const groups = filteredRecords();
    const labels = currentLabels();
    const totalRecords = groups.reduce((sum, group) => sum + group.length, 0);
    summary.textContent = totalRecords + " " + labels.records + " · " + groups.length + " " + labels.shown + (state.status === "all" ? "" : " · " + statusLabel(state.status));
    empty.hidden = groups.length !== 0;
    empty.textContent = labels.noResults;
    if (groups.length === 0) {
      clear(list);
      topSpacer.style.height = "0px";
      bottomSpacer.style.height = "0px";
      return;
    }
    const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
    const end = Math.min(groups.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight) + overscan);
    topSpacer.style.height = start * rowHeight + "px";
    bottomSpacer.style.height = Math.max(0, (groups.length - end) * rowHeight) + "px";
    clear(list);
    for (let index = start; index < end; index += 1) list.append(appendCard(groups[index]));
  }
  queryInput.addEventListener("input", () => { state.query = queryInput.value; viewport.scrollTop = 0; render(); });
  statusSelect.addEventListener("change", () => { state.status = statusSelect.value; viewport.scrollTop = 0; render(); });
  sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; viewport.scrollTop = 0; render(); });
  threadInput.addEventListener("change", () => { state.thread = threadInput.checked; viewport.scrollTop = 0; render(); });
  localeSelect.addEventListener("change", () => { state.locale = localeSelect.value; applyLabels(); });
  viewport.addEventListener("scroll", render, { passive: true });
  applyLabels();
})();`;
}

const VIEWER_STYLES = `
:root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b1014; color: #e7e9ea; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #0b1014; }
main { width: min(100%, 1080px); margin: 0 auto; padding: 20px; }
.hero { display: flex; gap: 16px; align-items: start; justify-content: space-between; border-bottom: 1px solid #38444d; padding-bottom: 16px; }
h1 { margin: 0; font-size: clamp(1.45rem, 5vw, 2.3rem); }
.hero p { color: #9aa6af; margin: 6px 0 0; max-width: 60ch; }
label { display: grid; gap: 6px; color: #9aa6af; font-size: .82rem; }
select, input { min-height: 42px; border: 1px solid #53636f; border-radius: 8px; background: #15202b; color: #e7e9ea; padding: 8px 10px; font-family: inherit; font-size: 1rem; }
.locale { min-width: 130px; }
.toolbar { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(130px, 1fr)) auto; gap: 10px; padding: 16px 0; }
.check { display: flex; align-items: end; gap: 8px; min-height: 42px; padding-bottom: 10px; white-space: nowrap; }
.check input { min-height: 20px; width: 20px; }
.summary { color: #9aa6af; margin: 0 0 12px; }
.empty { padding: 30px 12px; border: 1px dashed #53636f; border-radius: 12px; color: #9aa6af; }
.records { height: min(70vh, 720px); min-height: 300px; overflow: auto; border: 1px solid #38444d; border-radius: 12px; contain: strict; }
.canvas { min-height: 100%; }
.record-card { min-height: 160px; margin: 12px; padding: 14px; border: 1px solid #38444d; border-radius: 12px; background: #111820; overflow-wrap: anywhere; }
.record-heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h2 { font-size: 1rem; margin: 0; }
.handle, .date, small { color: #9aa6af; font-size: .78rem; }
.date { margin-inline-start: auto; }
.thread-count { color: #8ecdf1; font-size: .78rem; }
.body { white-space: pre-wrap; line-height: 1.45; margin: 12px 0 0; }
.media { display: grid; gap: 8px; margin-top: 12px; }
.media h3 { margin: 0; font-size: .85rem; }
.media-item { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: #18232d; }
.media-item img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; grid-row: span 2; }
.media-item a { color: #8ecdf1; overflow-wrap: anywhere; }
.media-item small { grid-column: 1 / -1; }
.status-captured-bytes { border-inline-start: 3px solid #35c759; }
.status-remote-reference { border-inline-start: 3px solid #f0b44d; }
.status-missing { border-inline-start: 3px solid #f15c6d; }
a { color: #8ecdf1; }
@media (max-width: 620px) {
  main { padding: 12px; }
  .hero { display: grid; }
  .toolbar { grid-template-columns: 1fr 1fr; }
  .toolbar label:first-child { grid-column: 1 / -1; }
  .check { align-items: center; padding: 0; }
  .records { min-height: 360px; }
  .media-item { grid-template-columns: 1fr; }
  .media-item img { width: 100%; height: 150px; grid-row: auto; }
}
`;

export const viewerLocales: readonly ViewerLocale[] = LOCALE_ORDER;
export type { ViewerLabels };
