/**
 * PRINCE MOVIE — api/proxy.js (fonction serverless Vercel) — version 2026-11-01-G
 * --------------------------------------------------------------------------------
 * Relaie l'API HTTP vers le site HTTPS, avec bascule automatique entre plusieurs
 * serveurs. Appel : /api/proxy?url=<adresse complète encodée>
 *
 * Serveurs de secours (même format que le premier) :
 *   - soit dans DEFAULT_SERVERS ci-dessous,
 *   - soit dans Vercel > Settings > Environment Variables :
 *       API_SERVERS = http://51.75.118.169:20245,http://AUTRE-IP:PORT
 *
 * Optionnel — limiter les hébergeurs d'images/vidéos relayés (recommandé) :
 *       ALLOWED_HOSTS = cdn.exemple.com,images.exemple.org
 *   (si la variable est absente, tout hôte PUBLIC est accepté, mais seulement
 *    pour des images, vidéos, audio et playlists HLS)
 *
 * IMPORTANT : ce fichier utilise "export default" → il faut le package.json fourni
 * à côté ({"type":"module"}). Le vercel.json fourni règle la durée maximale.
 */

const DEFAULT_SERVERS = [
  "http://51.75.118.169:20245",
  // "http://SERVEUR-2:PORT",
];

const clean = (s) => s.trim().replace(/\/+$/, "");
const SERVERS = (process.env.API_SERVERS ? process.env.API_SERVERS.split(",") : DEFAULT_SERVERS)
  .map(clean).filter(Boolean);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const TIMEOUT_MS = 12000;       // attente max par serveur
const TOTAL_BUDGET_MS = 24000;  // budget total (doit rester sous maxDuration de vercel.json)
const COOLDOWN_MS = 30000;      // un serveur en panne est mis de côté 30 s
const MAX_REDIRECTS = 4;
const MAX_BODY = 4_400_000;     // Vercel refuse les réponses > ~4,5 Mo
const down = new Map();

function orderedServers() {
  const now = Date.now();
  const up = SERVERS.filter((s) => (down.get(s) || 0) <= now);
  return [...up, ...SERVERS.filter((s) => !up.includes(s))];
}

// Empêche d'utiliser le proxy pour atteindre le réseau interne.
function isPrivateHost(h) {
  h = String(h).toLowerCase();
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h) ||
    h === "::1" || h.startsWith("[");
}
function hostAllowed(h) {
  if (!ALLOWED_HOSTS.length) return true;
  h = h.toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a));
}

// Réécrit une playlist HLS (.m3u8) pour que chaque segment repasse par ce proxy
// (sinon le navigateur bloque le contenu http:// sur une page https://).
function rewriteHls(text, baseUrl) {
  const wrap = (u) => {
    try { return "/api/proxy?url=" + encodeURIComponent(new URL(u, baseUrl).href); } catch (e) { return u; }
  };
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + wrap(u) + '"');
    return wrap(line.trim());
  }).join("\n");
}

// Requête qui suit les redirections À LA MAIN : chaque étape est revérifiée
// (sinon un site public pouvait rediriger vers le réseau interne).
async function get(url, { trusted = false, range = null, timeout = TIMEOUT_MS } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw Object.assign(new Error("Protocole non autorisé."), { blocked: true });
    const apiHost = SERVERS.includes(u.origin);
    if (!apiHost && (isPrivateHost(u.hostname) || !hostAllowed(u.hostname))) throw Object.assign(new Error("Hôte non autorisé."), { blocked: true });
    const headers = { Accept: "*/*", "User-Agent": "Mozilla/5.0 (compatible; PrinceMovieProxy/3.0)" };
    if (range) headers.Range = range;
    const r = await fetch(current, { headers, signal: AbortSignal.timeout(timeout), redirect: "manual" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location"), current).href;
      continue;
    }
    r.finalUrl = current;
    return r;
  }
  throw new Error("Trop de redirections.");
}

function fail(res, status, message) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ success: false, error: { message } });
}

const MEDIA_OK = /^(image|video|audio)\//i;
const PLAYLIST_OK = /mpegurl/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, X-Upstream");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Méthode non autorisée.");

  let raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!raw) return fail(res, 400, "Paramètre 'url' manquant.");
  // Vercel a déjà décodé le paramètre : on ne le décode PAS une 2e fois (ça cassait les
  // recherches avec accents ou "%"). Seule exception : une adresse encore encodée.
  if (/^https?%3A/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) {} }

  let target;
  try { target = new URL(raw); } catch (e) { return fail(res, 400, "Adresse invalide."); }
  if (target.protocol !== "http:" && target.protocol !== "https:") return fail(res, 400, "Protocole non autorisé.");

  const isApi = SERVERS.includes(target.origin);
  if (!isApi && (isPrivateHost(target.hostname) || !hostAllowed(target.hostname))) return fail(res, 403, "URL cible non autorisée.");

  const started = Date.now();
  const left = () => Math.max(1500, Math.min(TIMEOUT_MS, TOTAL_BUDGET_MS - (Date.now() - started)));
  const range = typeof req.headers.range === "string" ? req.headers.range : null;
  let upstream = null;
  let usedUrl = target.href;
  try {
    if (isApi) {
      // Même chemin, essayé sur chaque serveur jusqu'à obtenir une réponse.
      const pathAndQuery = target.pathname + target.search;
      // CORRECTION : la liste est figée UNE fois. Avant, elle était recalculée à chaque tour,
      // et "dernier serveur" désignait le mauvais → on perdait la vraie réponse d'erreur de l'API.
      const list = orderedServers();
      let lastErr = new Error("Aucun serveur");
      for (let i = 0; i < list.length; i++) {
        const base = list[i];
        const isLast = i === list.length - 1;
        if (Date.now() - started > TOTAL_BUDGET_MS) break;
        try {
          const r = await get(base + pathAndQuery, { trusted: true, range, timeout: left() });
          // S'il reste un autre serveur on bascule dessus ; sinon on renvoie la vraie
          // réponse d'erreur de l'API (utile pour afficher le bon message).
          if (r.status >= 500 && !isLast) { down.set(base, Date.now() + COOLDOWN_MS); lastErr = new Error(base + " → " + r.status); continue; }
          upstream = r;
          usedUrl = base + pathAndQuery;
          res.setHeader("X-Upstream", base);
          break;
        } catch (e) { down.set(base, Date.now() + COOLDOWN_MS); lastErr = e; }
      }
      if (!upstream) throw lastErr;
    } else {
      // Autre hôte (image, segment vidéo, playlist) : on ne relaie que des médias.
      upstream = await get(target.href, { range, timeout: left() });
      usedUrl = upstream.finalUrl || target.href;
      const ct = upstream.headers.get("content-type") || "";
      const okByType = MEDIA_OK.test(ct) || PLAYLIST_OK.test(ct);
      const okByName = /\.(m3u8|ts|m4s|mp4|aac|m4a|vtt)$/i.test(new URL(usedUrl).pathname) && /octet-stream|text\/plain|^$/i.test(ct);
      if (!okByType && !okByName) { try { await upstream.body?.cancel(); } catch (e) {} return fail(res, 403, "URL cible non autorisée."); }
    }
  } catch (err) {
    if (err && err.blocked) return fail(res, 403, "URL cible non autorisée.");
    return fail(res, 502, "Impossible de contacter l'API source (délai dépassé ou serveur injoignable).");
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  res.status(upstream.status);
  res.setHeader("Content-Type", contentType);

  // Flux vidéo en direct (HLS) : jamais en cache, segments réacheminés par le proxy.
  if (PLAYLIST_OK.test(contentType) || /\.m3u8$/i.test(new URL(usedUrl).pathname)) {
    const playlist = await upstream.text();
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    return res.send(rewriteHls(playlist, usedUrl));
  }
  const isSports = /\/api\/v1\/sports\//.test(target.pathname);

  if (/^(application\/json|text\/|application\/javascript)/i.test(contentType)) {
    const text = await upstream.text();
    // Cache navigateur/CDN seulement pour les réponses utiles : jamais une
    // erreur ni une liste vide (sinon elle resterait affichée vide).
    const cacheable = upstream.status === 200 &&
      !/"success"\s*:\s*false/.test(text) && !/"data"\s*:\s*\[\s*\]/.test(text);
    res.setHeader("Cache-Control", cacheable
      ? (isSports ? "public, s-maxage=10, stale-while-revalidate=20" : "public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400")
      : "no-store");
    return res.send(text);
  }

  // Images, segments vidéo et autres contenus binaires : relayés tels quels (avec Range pour l'avance rapide).
  const declared = Number(upstream.headers.get("content-length") || 0);
  if (declared > MAX_BODY) { try { await upstream.body?.cancel(); } catch (e) {} return fail(res, 413, "Fichier trop volumineux pour le proxy."); }
  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_BODY) return fail(res, 413, "Fichier trop volumineux pour le proxy.");
  for (const h of ["content-range", "accept-ranges"]) { const v = upstream.headers.get(h); if (v) res.setHeader(h, v); }
  res.setHeader("Cache-Control", (upstream.status === 200 || upstream.status === 206) ? "public, max-age=86400, s-maxage=86400" : "no-store");
  return res.send(buf);
}
