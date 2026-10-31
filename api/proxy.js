/**
 * PRINCE MOVIE — Proxy CORS/HTTPS intégré au projet Vercel
 * ---------------------------------------------------------
 * Ce fichier doit être placé dans un dossier "api" à la racine de ton
 * projet Vercel (au même niveau que index.html) :
 *
 *   mon-projet/
 *   ├── index.html
 *   └── api/
 *       └── proxy.js   <-- ce fichier
 *
 * Vercel détecte automatiquement tout fichier dans /api comme une
 * fonction serverless. Une fois déployé, il sera accessible à :
 *   https://ton-site.vercel.app/api/proxy?url=...
 *
 * Comme cette fonction tourne côté serveur (pas dans le navigateur), elle
 * peut appeler l'API HTTP sans le blocage "contenu mixte" que subit le
 * navigateur sur un site HTTPS. Et comme elle est sur le même domaine que
 * ton site, il n'y a même plus besoin de CORS ni de proxys publics tiers.
 *
 * AUCUNE INSTALLATION SUPPLÉMENTAIRE : pas de compte Cloudflare, pas de
 * dépendance npm. Il suffit que ce fichier soit dans /api lors du déploiement.
 */

const TARGET_ORIGIN = "http://51.75.118.170:20041";

function rewritePlaylist(text, baseUrl) {
  const toProxy = (u) => {
    let abs;
    try { abs = new URL(u, baseUrl).toString(); } catch (e) { return u; }
    return abs.startsWith(TARGET_ORIGIN) ? "/api/proxy?url=" + encodeURIComponent(abs) : abs;
  };
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + toProxy(u) + '"');
    return toProxy(t);
  }).join("\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const targetParam = req.query.url;
  let targetUrl;
  if (targetParam) {
    targetUrl = /^https?:\/\//i.test(targetParam) ? targetParam : decodeURIComponent(targetParam);
  } else {
    res.status(400).json({ success: false, error: { message: "Paramètre 'url' manquant." } });
    return;
  }

  if (!targetUrl.startsWith(TARGET_ORIGIN)) {
    res.status(403).json({ success: false, error: { message: "URL cible non autorisée." } });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: { Accept: "*/*" },
      signal: AbortSignal.timeout(15000),
    });
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);

    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(\?|#|$)/i.test(targetUrl);
    const isTextual = /^(application\/json|text\/|application\/javascript)/i.test(contentType);

    if (isPlaylist) {
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.send(rewritePlaylist(text, targetUrl));
    } else if (isTextual) {
      const text = await upstream.text();
      res.send(text);
    } else {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    }
  } catch (err) {
    res.status(502).json({ success: false, error: { message: "Impossible de contacter l'API source (délai dépassé ou serveur injoignable)." } });
  }
}
