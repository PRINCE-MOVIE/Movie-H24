const AUTH_KEY = "prince-movie-auth";
const API_BASE = "http://51.75.118.170:20041/api/v1";

const TYPE_LABEL = {
  movie: "Film",
  series: "Série",
  anime: "Animé",
  drama: "K-Drama",
  hentai: "Hentai",
  webtoon: "Webtoon"
};

const TYPE_ENDPOINTS = {
  movie: "movies",
  series: "series",
  anime: "anime",
  drama: "dramas",
  hentai: "hentai",
  webtoon: "webtoons"
};

const state = {
  selectedType: "movie",
  catalogPage: 1,
  lastCatalogPage: 1,
  isLoadingCatalog: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function titleCase(value) {
  return String(value ?? "").replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

async function api(path) {
  const direct = `${API_BASE}${path}`;
  const proxy = `/api/proxy?url=${encodeURIComponent(direct)}`;

  let lastError = null;

  for (const candidate of [proxy, direct]) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      if (json && json.success === false) {
        throw new Error(json.error?.message || "Erreur API");
      }
      return json;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Erreur API");
}

function isLoggedIn() {
  return Boolean(localStorage.getItem(AUTH_KEY));
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  const stored = (localStorage.getItem(AUTH_KEY) || "P").trim();
  $("#avatar").textContent = stored.charAt(0).toUpperCase() || "?";

  initHome();
}

function logout() {
  if (confirm("Se déconnecter ?")) {
    localStorage.removeItem(AUTH_KEY);
    location.reload();
  }
}

$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const email = $("#login-email").value.trim();
  if (!email) return;

  localStorage.setItem(AUTH_KEY, email);
  showApp();
});

$("#avatar").addEventListener("click", logout);

function switchView(name) {
  $$(".view").forEach((el) => el.classList.toggle("active", el.id === `${name}-view`));
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === name));
}

function showHome() {
  switchView("home");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showCatalog(type) {
  state.selectedType = type;
  switchView("catalog");
  window.scrollTo({ top: 0, behavior: "smooth" });
  openCatalog(type);
}

function showSearch() {
  switchView("search");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNav() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "home") return showHome();
      showCatalog(view);
    });
  });
}

async function initHome() {
  $("#rows").innerHTML = '<div class="loader">Chargement...</div>';

  try {
    const calls = [
      api("/movies?page=1"),
      api("/series?page=1"),
      api("/anime?page=1"),
      api("/dramas?page=1"),
      api("/hentai?page=1"),
      api("/webtoons?page=1")
    ];

    const results = await Promise.allSettled(calls);

    const movies = results[0].status === "fulfilled" ? (results[0].value.data || results[0].value || []) : [];
    const series = results[1].status === "fulfilled" ? (results[1].value.data || results[1].value || []) : [];
    const anime = results[2].status === "fulfilled" ? (results[2].value.data || results[2].value || []) : [];
    const dramas = results[3].status === "fulfilled" ? (results[3].value.data || results[3].value || []) : [];
    const hentai = results[4].status === "fulfilled" ? (results[4].value.data || results[4].value || []) : [];
    const webtoons = results[5].status === "fulfilled" ? (results[5].value.data || results[5].value || []) : [];

    const sections = [];
    if (movies.length) {
      renderHero(movies[0]);
      sections.push({ title: "Films populaires", items: movies, type: "movie" });
    }
    if (series.length) sections.push({ title: "Séries du moment", items: series, type: "series" });
    if (anime.length) sections.push({ title: "Animés", items: anime, type: "anime" });
    if (dramas.length) sections.push({ title: "K-Dramas", items: dramas, type: "drama" });
    if (hentai.length) sections.push({ title: "Hentai", items: hentai, type: "hentai" });
    if (webtoons.length) sections.push({ title: "Webtoons", items: webtoons, type: "webtoon" });

    $("#rows").innerHTML = "";
    sections.forEach((section) => $("#rows").appendChild(buildRow(section.title, section.items, section.type)));

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast("⚠ Certaines sections sont temporairement indisponibles.");
  } catch (error) {
    $("#rows").innerHTML = '<div class="empty-state">Impossible de charger l’accueil.</div>';
    toast("Erreur de chargement de l’accueil.");
  }
}

function renderHero(item) {
  if (!item) return;

  const bg = $("#hero-bg");
  const title = $("#hero-title");
  const meta = $("#hero-meta");
  const synopsis = $("#hero-synopsis");
  const playBtn = $("#hero-play");
  const infoBtn = $("#hero-info");

  bg.style.backgroundImage = `url('${safeText(item.image || item.poster || item.cover || "")}')`;
  title.textContent = item.title || "Titre";

  const year = item.year || item.release_year || "—";
  const version = item.version || "VF";
  const type = TYPE_LABEL[item.type] || "Film";

  meta.innerHTML = `
    <span class="meta-badge meta-green">97% compatible</span>
    <span class="meta-badge">${safeText(version)}</span>
    <span class="meta-badge">${safeText(type)}</span>
    <span class="meta-badge">${safeText(year)}</span>
  `;

  synopsis.textContent = item.synopsis || item.description || "À découvrir dans la bibliothèque PRINCE MOVIE.";

  playBtn.onclick = () => openDetail(item.type || state.selectedType, item.slug);
  infoBtn.onclick = () => openDetail(item.type || state.selectedType, item.slug);
}

function buildRow(title, items, type) {
  const row = document.createElement("div");
  row.className = "row-block";

  const head = document.createElement("div");
  head.className = "row-head";
  head.innerHTML = `<h3>${safeText(title)}</h3>`;

  const track = document.createElement("div");
  track.className = "row-scroll";

  items.slice(0, 12).forEach((item) => track.appendChild(makeCard(item, type)));
  row.append(head, track);
  return row;
}

function makeCard(item, type = item.type || state.selectedType) {
  const card = document.createElement("article");
  card.className = "card";

  const cleanTitle = item.title || "Sans titre";
  const image = item.image || item.poster || item.cover || "https://placehold.co/400x600/171a22/ffffff?text=PRINCE+MOVIE";

  const body = document.createElement("div");
  body.className = "card-body";
  body.innerHTML = `
    <span class="card-type">${safeText(TYPE_LABEL[type] || titleCase(type))}</span>
    <div class="card-title">${safeText(cleanTitle)}</div>
    <div class="card-sub">${safeText(item.year || item.release_year || "")}</div>
  `;

  const img = document.createElement("img");
  img.src = image;
  img.alt = cleanTitle;
  img.loading = "lazy";
  img.onerror = () => {
    img.src = "https://placehold.co/400x600/171a22/ffffff?text=PRINCE+MOVIE";
  };

  card.append(img, body);
  card.addEventListener("click", () => openDetail(type || item.type || state.selectedType, item.slug));
  return card;
}

async function openCatalog(type) {
  state.selectedType = type;
  const grid = $("#catalog-grid");
  grid.innerHTML = '<div class="empty-state">Chargement du catalogue...</div>';
  $("#catalog-title").textContent = TYPE_LABEL[type] || titleCase(type);

  try {
    const result = await api(`/${TYPE_ENDPOINTS[type]}?page=1`);
    const items = result.data || result || [];
    state.lastCatalogPage = result.meta?.last_page || 1;

    grid.innerHTML = "";
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state">Aucun résultat trouvé.</div>';
      $("#catalog-more").style.display = "none";
      return;
    }

    items.forEach((item) => grid.appendChild(makeCard({ ...item, type }, type)));
    $("#catalog-more").style.display = state.catalogPage < state.lastCatalogPage ? "inline-flex" : "none";
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">Le catalogue est actuellement indisponible.</div>';
    toast("Impossible de charger le catalogue.");
  }
}

$("#catalog-more").addEventListener("click", async () => {
  if (state.isLoadingCatalog || state.catalogPage >= state.lastCatalogPage) return;

  state.isLoadingCatalog = true;
  state.catalogPage += 1;
  $("#catalog-more").textContent = "Chargement...";

  try {
    const result = await api(`/${TYPE_ENDPOINTS[state.selectedType]}?page=${state.catalogPage}`);
    const items = result.data || result || [];
    const grid = $("#catalog-grid");
    items.forEach((item) => grid.appendChild(makeCard({ ...item, type: state.selectedType }, state.selectedType)));
  } catch (error) {
    state.catalogPage -= 1;
    toast("Erreur lors du chargement de la page suivante.");
  } finally {
    state.isLoadingCatalog = false;
    $("#catalog-more").textContent = "Charger plus";
    $("#catalog-more").style.display = state.catalogPage < state.lastCatalogPage ? "inline-flex" : "none";
  }
});

$("#search-toggle").addEventListener("click", () => {
  const term = $("#search-input").value.trim();
  if (term) doSearch(term);
  else $("#search-input").focus();
});

$("#search-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const term = $("#search-input").value.trim();
    if (term) doSearch(term);
  }
});

async function doSearch(term) {
  showSearch();
  const grid = $("#search-grid");
  grid.innerHTML = '<div class="empty-state">Recherche en cours...</div>';
  $("#search-title").textContent = `Recherche : ${term}`;

  try {
    const result = await api(`/search?q=${encodeURIComponent(term)}`);
    const items = result.data || result || [];
    grid.innerHTML = "";

    if (!items.length) {
      grid.innerHTML = '<div class="empty-state">Aucun résultat trouvé.</div>';
      return;
    }

    items.forEach((item) => grid.appendChild(makeCard(item, item.type || state.selectedType)));
  } catch (error) {
    grid.innerHTML = '<div class="empty-state">La recherche a échoué. Réessayez.</div>';
    toast("La recherche a échoué.");
  }
}

async function openDetail(type, slug) {
  const modal = $("#detail-modal");
  const content = $("#detail-content");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  content.innerHTML = '<div class="empty-state">Chargement du détail...</div>';

  try {
    const endpoint = TYPE_ENDPOINTS[type] || TYPE_ENDPOINTS.movie;
    const result = await api(`/${endpoint}/${encodeURIComponent(slug)}`);
    const item = result.data || result || {};
    renderDetail(item, type);
  } catch (error) {
    content.innerHTML = '<div class="empty-state">Ce contenu est introuvable ou non disponible.</div>';
    toast("Contenu introuvable.");
  }
}

function renderDetail(item, type) {
  const content = $("#detail-content");
  const episodes = item.episodes || [];
  const chapters = item.chapters || [];
  const related = item.related || [];

  const metaYear = item.year || item.release_year || "—";
  const status = item.status ? `<span>${safeText(item.status)}</span>` : "";
  const version = item.version || "VF";
  const genres = Array.isArray(item.genres)
    ? item.genres.map((g) => `<span class="meta-badge">${safeText(g)}</span>`).join("")
    : "";
  const synopsis = item.synopsis || item.description || "Aucune description disponible.";

  const primaryAction =
    item.type === "webtoon" || type === "webtoon"
      ? '<button class="button primary" type="button" data-read-webtoon>📖 Lire le webtoon</button>'
      : '<button class="button primary" type="button" data-play-main>▶ Lecture</button>';

  content.innerHTML = `
    <div class="detail-hero" style="background-image:url('${safeText(item.image || item.poster || item.cover || "")}')">
      <div class="detail-hero-content">
        <h2>${safeText(item.title || "Titre")}</h2>
      </div>
    </div>

    <div class="detail-body">
      <div class="detail-meta">
        <span class="green">${safeText(metaYear)}</span>
        ${status}
        <span class="meta-badge">${safeText(TYPE_LABEL[type] || titleCase(type))}</span>
        <span class="meta-badge">${safeText(version)}</span>
      </div>

      <div class="detail-genres">${genres}</div>
      <div class="detail-actions">${primaryAction}</div>
      <p class="detail-synopsis">${safeText(synopsis)}</p>

      ${buildEpisodesMarkup(type, episodes, item)}
      ${chapters.length ? buildChaptersMarkup(chapters) : ""}
      ${related.length
        ? `<div class="section-label">Titres similaires</div><div class="related-row">${related.slice(0, 8).map((r) => makeCardMarkup(r, r.type || type)).join("")}</div>`
        : ""}
    </div>
  `;

  const mainPlay = content.querySelector("[data-play-main]");
  if (mainPlay) mainPlay.addEventListener("click", () => playContent(item, type));

  const readWebtoon = content.querySelector("[data-read-webtoon]");
  if (readWebtoon) {
    readWebtoon.addEventListener("click", () => {
      closeModal("detail-modal");
      openWebtoonReader(item.slug, item.title, chapters || [], chapters[0]?.chapter_id || item.first_chapter_id || "");
    });
  }

  content.querySelectorAll("[data-episode]").forEach((button) => {
    button.addEventListener("click", () => {
      const episodeId = button.dataset.episode;
      const title = `${item.title} — ${button.dataset.title || "Épisode"}`;
      playEpisodeFromId(type, item.slug, episodeId, title);
    });
  });

  content.querySelectorAll("[data-chapter]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal("detail-modal");
      openWebtoonReader(item.slug, item.title, chapters || [], button.dataset.chapter);
    });
  });
}

function buildEpisodesMarkup(type, episodes, item) {
  if (!episodes.length) return "";

  return `
    <div class="section-label">Épisodes</div>
    <div class="episode-list">
      ${episodes.map((ep) => `
        <button class="episode-item" type="button" data-episode="${safeText(ep.episode_id || ep.id || ep.slug)}" data-title="${safeText(ep.title || `Épisode ${ep.number || ""}`)}">
          <span class="episode-num">${safeText(ep.number || ep.episode || "")}</span>
          <span class="episode-copy">
            <strong>${safeText(ep.title || `Épisode ${ep.number || ""}`)}</strong>
            <span>${safeText(ep.version || item.version || "VF")}</span>
          </span>
          <span class="episode-play">▶</span>
        </button>
      `).join("")}
    </div>
  `;
}

function buildChaptersMarkup(chapters) {
  if (!chapters.length) return "";

  return `
    <div class="section-label">Chapitres</div>
    <div class="episode-list">
      ${chapters.slice().reverse().map((ch) => `
        <button class="episode-item" type="button" data-chapter="${safeText(ch.chapter_id || ch.id || ch.slug)}">
          <span class="episode-num">📄</span>
          <span class="episode-copy">
            <strong>${safeText(ch.title || `Chapitre ${ch.number || ""}`)}</strong>
            <span>${safeText(ch.number || "")}</span>
          </span>
          <span class="episode-play">→</span>
        </button>
      `).join("")}
    </div>
  `;
}

function makeCardMarkup(item, type) {
  const title = item.title || "Titre";
  const image = item.image || item.poster || item.cover || "https://placehold.co/400x600/171a22/ffffff?text=PRINCE+MOVIE";

  return `
    <article class="card" data-card-slug="${safeText(item.slug || "")}" data-card-type="${safeText(type)}">
      <img src="${safeText(image)}" alt="${safeText(title)}" loading="lazy" />
      <div class="card-body">
        <span class="card-type">${safeText(TYPE_LABEL[type] || titleCase(type))}</span>
        <div class="card-title">${safeText(title)}</div>
        <div class="card-sub">${safeText(item.year || item.release_year || "")}</div>
      </div>
    </article>
  `;
}

async function playContent(item, type) {
  try {
    const endpoint = TYPE_ENDPOINTS[type] || TYPE_ENDPOINTS.movie;
    const result = await api(`/${endpoint}/${encodeURIComponent(item.slug)}`);
    const detail = result.data || result || {};
    const firstEpisode = detail.first_episode_id || detail.episodes?.[0]?.episode_id || detail.chapters?.[0]?.chapter_id;

    if (type === "webtoon" || detail.type === "webtoon") {
      closeModal("detail-modal");
      openWebtoonReader(detail.slug, detail.title, detail.chapters || [], firstEpisode || "");
      return;
    }

    if (firstEpisode) {
      playEpisodeFromId(type, detail.slug, firstEpisode, detail.title);
      return;
    }

    toast("Aucune lecture disponible pour ce titre.");
  } catch (error) {
    toast("Lecture impossible pour le moment.");
  }
}

async function playEpisodeFromId(type, slug, episodeId, title) {
  const modal = $("#player-modal");
  const frame = $("#player-frame");
  const serverList = $("#server-list");

  serverList.innerHTML = '<span class="muted">Chargement des serveurs...</span>';
  frame.src = "";
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  $("#player-title").textContent = title;

  try {
    let path = "";

    if (type === "movie") {
      path = `/movies/${encodeURIComponent(slug)}/servers`;
    } else if (type === "series" || type === "anime" || type === "drama" || type === "hentai") {
      path = `/${TYPE_ENDPOINTS[type]}/${encodeURIComponent(slug)}/servers?episode=${encodeURIComponent(episodeId)}`;
    } else {
      path = `/episodes/${encodeURIComponent(episodeId)}/servers`;
    }

    const result = await api(path);
    const servers = result.data || result || [];

    if (!servers.length) {
      serverList.innerHTML = '<span class="muted">Aucun serveur disponible pour le moment.</span>';
      return;
    }

    serverList.innerHTML = "";
    servers.forEach((server, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `server-btn ${index === 0 ? "active" : ""}`;
      button.textContent = server.server_name || `Serveur ${index + 1}`;

      button.addEventListener("click", () => {
        $(".server-btn.active")?.classList.remove("active");
        button.classList.add("active");
        frame.src = server.server_link || server.link || "";
      });

      serverList.appendChild(button);
    });

    frame.src = servers[0].server_link || servers[0].link || "";
  } catch (error) {
    serverList.innerHTML = '<span class="muted">Impossible de charger les serveurs.</span>';
    toast("Le lecteur n’a pas pu démarrer.");
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("open");
  if (id === "player-modal") $("#player-frame").src = "";
  document.body.style.overflow = "";
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});

document.querySelectorAll(".modal-backdrop").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeModal(modal.id);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal("detail-modal");
    closeModal("player-modal");
  }
});

function openWebtoonReader(slug, title, chapters = [], selectedChapterId = "") {
  const params = new URLSearchParams({
    slug,
    title,
    chapter: selectedChapterId || chapters[0]?.chapter_id || ""
  });
  window.location.href = `lecteur.html?${params.toString()}`;
}

bindNav();

if (isLoggedIn()) {
  showApp();
} else {
  $("#login-screen").classList.remove("hidden");
}

window.addEventListener("load", () => {
  if (isLoggedIn()) showApp();
});
