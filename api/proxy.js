/**
 * PRINCE MOVIE — Proxy HTTPS/CORS (fonction serverless Vercel)
 * Emplacement OBLIGATOIRE :  <racine du projet>/api/proxy.js
 * (à côté de index.html et vercel.json). Après déploiement, tester :
 *   https://TON-SITE/api/proxy?url=http%3A%2F%2F51.75.118.170%3A20041%2Fapi%2Fv1%2Fmovies
 * Si cette adresse renvoie du JSON, le proxy fonctionne.
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
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  if (!targetUrl) {
    res.status(400).json({ success: false, error: { message: "Paramètre 'url' manquant." } });
    return;
  }
  if (!/^https?:\/\//i.test(targetUrl)) {
    try { targetUrl = decodeURIComponent(targetUrl); } catch (e) {}
  }
  // Sécurité : uniquement l'API attendue (pas de proxy ouvert).
  if (!targetUrl.startsWith(TARGET_ORIGIN)) {
    res.status(403).json({ success: false, error: { message: "URL cible non autorisée." } });
    return;
  }

  try {
    const headers = { Accept: "*/*", "User-Agent": "Mozilla/5.0 (PrinceMovie proxy)" };
    if (req.headers.range) headers.Range = req.headers.range;   // lecture / avance rapide des vidéos
    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", /json/i.test(contentType) ? "s-maxage=60, stale-while-revalidate=300" : "public, max-age=3600");
    for (const h of ["content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (req.method === "HEAD") { res.end(); return; }

    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(\?|#|$)/i.test(targetUrl);
    const isTextual = /^(application\/json|text\/|application\/javascript)/i.test(contentType);
    if (isPlaylist) {
      const text = await upstream.text();
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.send(rewritePlaylist(text, targetUrl));
    } else if (isTextual) {
      res.send(await upstream.text());
    } else {
      // NB : Vercel limite une réponse de fonction à ~4,5 Mo. Les images et les
      // petits segments passent ; un gros fichier vidéo complet, non.
      res.send(Buffer.from(await upstream.arrayBuffer()));
    }
  } catch (err) {
    const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
    res.status(502).json({
      success: false,
      error: { message: timeout ? "L'API source met trop de temps à répondre." : "Impossible de contacter l'API source (serveur éteint ou injoignable).", detail: String(err && err.message || err) },
    });
  }
}
