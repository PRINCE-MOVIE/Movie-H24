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
    targetUrl = decodeURIComponent(targetParam);
  } else {
    res.status(400).json({ success: false, error: { message: "Paramètre 'url' manquant." } });
    return;
  }

  // Sécurité : on n'autorise ce proxy qu'à parler à l'API attendue, pour
  // éviter qu'il ne serve de proxy ouvert vers n'importe quel site.
  if (!targetUrl.startsWith(TARGET_ORIGIN)) {
    res.status(403).json({ success: false, error: { message: "URL cible non autorisée." } });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: { "Accept": "application/json" },
      // Le backend HTTP est parfois lent : on laisse un peu de marge avant
      // d'abandonner, plutôt que de dépendre uniquement du timeout du
      // navigateur côté front.
      signal: AbortSignal.timeout(15000),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({ success: false, error: { message: "Impossible de contacter l'API source (délai dépassé ou serveur injoignable)." } });
  }
}
