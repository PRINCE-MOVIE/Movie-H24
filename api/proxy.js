/**
 * PRINCE MOVIE — Proxy CORS/HTTPS (Vercel, dossier /api)
 * Accessible à : /api/proxy?url=<URL encodée>
 *
 * Corrections par rapport à l'ancienne version :
 *  - Les vidéos (mp4/webm) passent maintenant en STREAMING, avec support des
 *    requêtes "Range" (indispensable pour lire/avancer dans une vidéo).
 *    Avant, tout le fichier était chargé en mémoire puis renvoyé d'un bloc :
 *    impossible pour une vidéo, et limité à ~4,5 Mo sur Vercel.
 *  - Le délai de 15 s ne coupe plus un flux vidéo en cours de lecture
 *    (il ne s'applique qu'à l'attente de la réponse).
 *  - Plus de double décodage de l'URL (cassait les noms de fichiers avec
 *    espaces ou caractères encodés).
 *  - Vérification de l'origine par URL parsée (et non par simple préfixe).
 */
import { Readable } from "node:stream";

const TARGET_ORIGIN = "http://51.75.118.170:20041";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  if (!targetUrl) {
    res.status(400).json({ success: false, error: { message: "Paramètre 'url' manquant." } });
    return;
  }
  const allowed = new URL(TARGET_ORIGIN).origin;
  const isAllowed = (u) => { try { return new URL(u).origin === allowed; } catch (e) { return false; } };
  if (!isAllowed(targetUrl)) {
    // tolérance : URL encodée deux fois par un appelant
    try { const d = decodeURIComponent(targetUrl); if (isAllowed(d)) targetUrl = d; } catch (e) {}
  }
  if (!isAllowed(targetUrl)) {
    res.status(403).json({ success: false, error: { message: "URL cible non autorisée." } });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);   // attente de la réponse uniquement
  req.on("close", () => controller.abort());
  try {
    const headers = { "Accept": "*/*" };
    if (req.headers.range) headers["Range"] = req.headers.range;
    const upstream = await fetch(targetUrl, { headers, signal: controller.signal, method: req.method === "HEAD" ? "HEAD" : "GET" });
    clearTimeout(timer);   // la réponse est arrivée : on ne coupe plus le flux

    const contentType = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    const isTextual = /^(application\/json|text\/|application\/javascript)/i.test(contentType);
    if (isTextual) {
      res.removeHeader("content-length");
      res.send(await upstream.text());
    } else if (upstream.body) {
      Readable.fromWeb(upstream.body).on("error", () => res.end()).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    clearTimeout(timer);
    if (!res.headersSent) {
      res.status(502).json({ success: false, error: { message: "Impossible de contacter l'API source (délai dépassé ou serveur injoignable)." } });
    } else {
      res.end();
    }
  }
}
