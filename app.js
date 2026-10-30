function getEpisodeSeasonNumber(ep = {}) {
  const candidates = [
    ep.season,
    ep.season_number,
    ep.seasonNumber,
    ep.season_id,
    ep.saison,
    ep.saison_number,
    ep.seasonNo
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }

  const text = String(ep.season ?? ep.saison ?? "");
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

function getEpisodeNumber(ep = {}) {
  const candidates = [
    ep.episode,
    ep.episode_number,
    ep.episodeNumber,
    ep.numero,
    ep.number,
    ep.num,
    ep.episode_num
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }

  const text = String(ep.episode ?? ep.numero ?? ep.number ?? "");
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function groupEpisodesBySeason(episodes = []) {
  const map = new Map();

  [...episodes]
    .map((ep) => ({
      ...ep,
      __season: getEpisodeSeasonNumber(ep),
      __episode: getEpisodeNumber(ep)
    }))
    .sort((a, b) => {
      if (a.__season !== b.__season) return a.__season - b.__season;
      return a.__episode - b.__episode;
    })
    .forEach((ep) => {
      const key = Number.isFinite(ep.__season) ? ep.__season : 1;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ep);
    });

  return Array.from(map.entries()).map(([season, items]) => ({
    season,
    items: items.sort((a, b) => a.__episode - b.__episode)
  }));
}

function normalizeEpisodes(item = {}) {
  if (Array.isArray(item.episodes) && item.episodes.length) return item.episodes;
  if (Array.isArray(item.seasons)) {
    const nested = item.seasons.flatMap((season) => {
      if (Array.isArray(season.episodes)) return season.episodes;
      if (Array.isArray(season.items)) return season.items;
      return [];
    });
    if (nested.length) return nested;
  }
  return [];
}

function buildEpisodesMarkup(type, episodes, item) {
  const safeEpisodes = normalizeEpisodes(item);
  const sourceEpisodes = Array.isArray(episodes) && episodes.length ? episodes : safeEpisodes;
  if (!sourceEpisodes.length) return "";

  const groups = groupEpisodesBySeason(sourceEpisodes);

  return `
    <div class="section-label">Épisodes</div>
    ${groups.map(({ season, items }) => `
      <div style="margin-top: 16px;">
        <div style="margin: 0 0 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #ff5b5b; font-weight: 800;">
          Saison ${season}
        </div>
        <div class="episode-list">
          ${items.map((ep) => `
            <button class="episode-item" type="button" data-episode="${safeText(ep.episode_id || ep.id || ep.slug)}" data-title="${safeText(ep.title || `Épisode ${ep.number || ep.episode || ""}`)}">
              <span class="episode-num">${safeText(ep.number || ep.episode || ep.episode_number || "")}</span>
              <span class="episode-copy">
                <strong>${safeText(ep.title || `Épisode ${ep.number || ep.episode || ep.episode_number || ""}`)}</strong>
                <span>${safeText(ep.version || item.version || "VF")}</span>
              </span>
              <span class="episode-play">▶</span>
            </button>
          `).join("")}
        </div>
      </div>
    `).join("")}
  `;
}

function renderDetail(item, type) {
  const content = $("#detail-content");
  const episodes = normalizeEpisodes(item);
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
