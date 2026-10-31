// api/proxy.js — Fonction serverless Vercel
//
// Rôle : faire passer l'API (http) par ton site (https) pour que les films,
// images et vidéos se lisent normalement, et basculer automatiquement sur un
// autre serveur si le premier ne répond pas.
//
// Utilisation côté site :
//   /api/proxy?path=/films            → appelle  <serveur>/films
//   /api/proxy?u=http://IP:PORT/x.mp4 → vidéo / image d'un de tes serveurs
//
// Ajouter des serveurs : liste ci-dessous, ou variable d'environnement Vercel
//   API_SERVERS="http://51.75.118.170:20041,http://AUTRE-IP:PORT"
// Hôtes externes autorisés pour les vidéos (CDN…) :
//   ALLOWED_HOSTS="cdn.exemple.com,autre-cdn.com"

const { Readable } = require('stream');

const DEFAULT_SERVERS = [
  'http://51.75.118.170:20041'
  // 'http://SERVEUR-2:PORT',
  // 'http://SERVEUR-3:PORT',
];

const clean = s => s.trim().replace(/\/+$/, '');
const SERVERS = (process.env.API_SERVERS ? process.env.API_SERVERS.split(',') : DEFAULT_SERVERS).map(clean).filter(Boolean);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const TIMEOUT_MS = 8000;      // attente max avant de passer au serveur suivant
const COOLDOWN_MS = 30000;    // un serveur en panne est mis de côté 30 s
const down = new Map();       // serveur -> date de fin de mise de côté

function order() {
  const now = Date.now();
  const up = SERVERS.filter(s => (down.get(s) || 0) <= now);
  const rest = SERVERS.filter(s => !up.includes(s));
  return [...up, ...rest];
}

async function fetchWithTimeout(url, headers) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// Essaie chaque serveur dans l'ordre jusqu'à obtenir une réponse correcte.
async function fromServers(path, headers) {
  let lastError = new Error('Aucun serveur configuré');
  for (const base of order()) {
    try {
      const r = await fetchWithTimeout(base + path, headers);
      if (r.status >= 500) {
        down.set(base, Date.now() + COOLDOWN_MS);
        lastError = new Error(`${base} → ${r.status}`);
        continue;
      }
      return { r, base };
    } catch (e) {
      down.set(base, Date.now() + COOLDOWN_MS);
      lastError = e;
    }
  }
  throw lastError;
}

function safePath(p) {
  if (!p) return null;
  if (!p.startsWith('/')) p = '/' + p;
  if (p.startsWith('//') || p.includes('..') || p.includes('://') || /[\r\n]/.test(p)) return null;
  return p;
}

// Réécrit une playlist .m3u8 pour que les segments passent aussi par le proxy.
function rewriteM3u8(text, basePath, baseOrigin) {
  const dir = basePath.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  const wrap = line => {
    const l = line.trim();
    if (!l) return line;
    if (l.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${wrapUri(uri)}"`);
    }
    return wrapUri(l);
  };
  const wrapUri = uri => {
    if (/^https?:\/\//i.test(uri)) return `/api/proxy?u=${encodeURIComponent(uri)}`;
    const abs = uri.startsWith('/') ? uri : dir + uri;
    return `/api/proxy?path=${encodeURIComponent(abs)}`;
  };
  return text.split(/\r?\n/).map(wrap).join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Méthode non autorisée' });

  const q = new URL(req.url, 'http://localhost').searchParams;
  let path = q.get('path');
  const u = q.get('u');
  let direct = null;

  if (u) {
    let url;
    try { url = new URL(u); } catch (e) { return res.status(400).json({ error: 'Adresse invalide' }); }
    if (SERVERS.includes(url.origin)) {
      path = url.pathname + url.search;          // même serveur → bascule possible
    } else if (ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
      direct = url.href;                          // hôte externe autorisé
    } else {
      return res.status(403).json({ error: 'Hôte non autorisé' });
    }
  }

  if (!direct) {
    path = safePath(path);
    if (!path) return res.status(400).json({ error: 'Paramètre path manquant ou invalide' });
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; AzurProxy/1.0)', Accept: req.headers.accept || '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;

  let r, base = null;
  try {
    if (direct) {
      r = await fetchWithTimeout(direct, headers);
    } else {
      ({ r, base } = await fromServers(path, headers));
    }
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Tous les serveurs sont indisponibles pour le moment', detail: String((e && (e.cause && e.cause.code || e.message)) || e) });
  }

  const type = r.headers.get('content-type') || '';
  const target = direct || path;
  const isM3u8 = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(target);
  const isJson = /json/i.test(type);
  const isImage = /^image\//i.test(type);

  res.status(r.status);
  if (base) res.setHeader('X-Upstream', base);
  if (type) res.setHeader('Content-Type', type);

  // Cache : limite la charge sur l'API et garde le site en vie si elle tombe.
  if (r.status === 200 || r.status === 206) {
    if (isJson) res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400');
    else if (isImage) res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    else if (isM3u8) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=600');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }

  if (isM3u8 && r.status === 200) {
    const text = await r.text();
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.send(rewriteM3u8(text, target, base));
  }

  for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = r.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  if (req.method === 'HEAD' || !r.body) return res.end();

  // Lecture en flux : la vidéo démarre sans attendre le fichier entier.
  const stream = Readable.fromWeb(r.body);
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
};
