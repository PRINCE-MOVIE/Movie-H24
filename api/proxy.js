/**
 * PRINCE MOVIE — api/proxy.js (fonction serverless Vercel)
 * --------------------------------------------------------
 * Relaie l'API HTTP vers le site HTTPS, avec bascule automatique entre
 * plusieurs serveurs. Appel : /api/proxy?url=<adresse complète encodée>
 *
 * Ajouter des serveurs de secours (même format que le premier) :
 *   - soit dans la liste DEFAULT_SERVERS ci-dessous,
 *   - soit dans Vercel > Settings > Environment Variables :
 *       API_SERVERS = http://51.75.118.170:20041,http://AUTRE-IP:PORT
 *
 * IMPORTANT : ce fichier utilise la syntaxe "export default". Il faut donc
 * le package.json fourni à côté ({"type":"module"}), sinon Vercel plante.
 */

const DEFAULT_SERVERS = [
  "http://51.75.118.170:20041",
  // "http://SERVEUR-2:PORT",
];

const clean = (s) => s.trim().replace(/\/+$/, "");
const SERVERS = (process.env.API_SERVERS ? process.env.API_SERVERS.split(",") : DEFAULT_SERVERS)
  .map(clean).filter(Boolean);

const TIMEOUT_MS = 9000;     // attente max par serveur avant de passer au suivant
const COOLDOWN_MS = 30000;   // un serveur en panne est mis de côté 30 s
const down = new Map();

function orderedServers() {
  const now = Date.now();
  const up = SERVERS.filter((s) => (down.get(s) || 0) <= now);
  return [...up, ...SERVERS.filter((s) => !up.includes(s))];
}

// Empêche d'utiliser le proxy pour atteindre le réseau interne.
function isPrivateHost(h) {
  h = h.toLowerCase();
  return h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === "::1" || h.startsWith("[");
}

async function get(url) {
  return fetch(url, {
    headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 (compatible; PrinceMovieProxy/2.0)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
}

function fail(res, status, message) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ success: false, error: { message } });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Méthode non autorisée.");

  let raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!raw) return fail(res, 400, "Paramètre 'url' manquant.");
  // Vercel a déjà décodé le paramètre : on ne le décode PAS une 2e fois
  // (ça cassait les recherches avec accents ou "%"). Seule exception :
  // une adresse encore encodée ("http%3A%2F%2F...").
  if (/^https?%3A/i.test(raw)) { try { raw = decodeURIComponent(raw); } catch (e) {} }

  let target;
  try { target = new URL(raw); } catch (e) { return fail(res, 400, "Adresse invalide."); }
  if (target.protocol !== "http:" && target.protocol !== "https:") return fail(res, 400, "Protocole non autorisé.");

  const isApi = SERVERS.includes(target.origin);
  if (!isApi && isPrivateHost(target.hostname)) return fail(res, 403, "URL cible non autorisée.");

  let upstream = null;
  try {
    if (isApi) {
      // Même chemin, essayé sur chaque serveur jusqu'à obtenir une réponse.
      const pathAndQuery = target.pathname + target.search;
      let lastErr = new Error("Aucun serveur");
      for (const base of orderedServers()) {
        try {
          const r = await get(base + pathAndQuery);
          if (r.status >= 500) { down.set(base, Date.now() + COOLDOWN_MS); lastErr = new Error(base + " → " + r.status); continue; }
          upstream = r;
          res.setHeader("X-Upstream", base);
          break;
        } catch (e) { down.set(base, Date.now() + COOLDOWN_MS); lastErr = e; }
      }
      if (!upstream) throw lastErr;
    } else {
      // Autre hôte (ex. image hébergée ailleurs) : on ne relaie que des images.
      upstream = await get(target.href);
      const ct = upstream.headers.get("content-type") || "";
      if (!/^image\//i.test(ct)) return fail(res, 403, "URL cible non autorisée.");
    }
  } catch (err) {
    return fail(res, 502, "Impossible de contacter l'API source (délai dépassé ou serveur injoignable).");
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  res.status(upstream.status);
  res.setHeader("Content-Type", contentType);

  if (/^(application\/json|text\/|application\/javascript)/i.test(contentType)) {
    const text = await upstream.text();
    // Cache navigateur/CDN seulement pour les réponses utiles : jamais une
    // erreur ni une liste vide (sinon elle resterait affichée vide).
    const cacheable = upstream.status === 200 &&
      !/"success"\s*:\s*false/.test(text) && !/"data"\s*:\s*\[\s*\]/.test(text);
    res.setHeader("Cache-Control", cacheable
      ? "public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
      : "no-store");
    return res.send(text);
  }

  // Images et autres contenus binaires : relayés tels quels.
  res.setHeader("Cache-Control", upstream.status === 200 ? "public, max-age=86400, s-maxage=86400" : "no-store");
  return res.send(Buffer.from(await upstream.arrayBuffer()));
}
