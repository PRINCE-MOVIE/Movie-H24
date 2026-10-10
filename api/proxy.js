/**
 * PRINCE MOVIE — Proxy CORS/HTTPS (Vercel, dossier /api)
 * Accessible à : /api/proxy?url=<URL encodée>
 *
 * - JSON et images : même comportement que l'ancienne version (réponse lue
 *   en entier puis renvoyée), + mise en cache côté Vercel pour accélérer
 *   fortement les chargements répétés.
 * - Vidéos (video/*, audio/*) : STREAMING avec support de "Range", pour
 *   pouvoir lire et avancer dans un fichier sans le charger en mémoire.
 */
const TARGET_ORIGIN = "http://51.75.118.170:20041";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  if (!targetUrl) {
    res.status(400).json({ success: false, error: { message: "Paramètre 'url' manquant." } });
    return;
  }
  const allowedOrigin = new URL(TARGET_ORIGIN).origin;
  const isAllowed = (u) => { try { return new URL(u).origin === allowedOrigin; } catch (e) { return false; } };
  if (!isAllowed(targetUrl)) {
    try { const d = decodeURIComponent(targetUrl); if (isAllowed(d)) targetUrl = d; } catch (e) {}
  }
  if (!isAllowed(targetUrl)) {
    res.status(403).json({ success: false, error: { message: "URL cible non autorisée." } });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { "Accept": "*/*" };
    if (req.headers.range) headers["Range"] = req.headers.range;
    const upstream = await fetch(targetUrl, { headers, signal: controller.signal });

    const contentType = upstream.headers.get("content-type") || "application/json";
    const isMedia = /^(video|audio)\//i.test(contentType) || (!!req.headers.range && /octet-stream/i.test(contentType));

    if (isMedia && upstream.body) {
      // Streaming : plus de limite de temps/taille de 15 s une fois la réponse démarrée
      clearTimeout(timer);
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      for (const h of ["content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.on("close", () => controller.abort());   // client parti : on coupe l'amont
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) await new Promise(r => res.once("drain", r));
        }
      } catch (e) { /* client parti ou flux coupé */ }
      res.end();
      return;
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    const isTextual = /^(application\/json|text\/|application\/javascript)/i.test(contentType);
    if (isTextual) {
      const text = await upstream.text();
      // Cache seulement les réponses réussies de l'API (jamais une erreur)
      if (upstream.status === 200 && /"success"\s*:\s*true/.test(text)) {
        res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      }
      res.send(text);
    } else {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (upstream.status === 200 && /^image\//i.test(contentType)) {
        res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
      }
      res.send(buffer);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ success: false, error: { message: "Impossible de contacter l'API source (délai dépassé ou serveur injoignable)." } });
    } else {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}
