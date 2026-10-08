/**
 * PRINCE MOVIE — Registre des utilisateurs (fonction serverless Vercel)
 * ---------------------------------------------------------------------
 * Fichier à placer dans  api/users.js  (à côté de api/proxy.js).
 *
 * Rôle :
 *   - "register" : appelée par le site à chaque connexion / inscription.
 *                  Enregistre l'email (+ nom, prénom) dans la base.
 *                  Le mot de passe n'est JAMAIS envoyé ni stocké ici.
 *   - "list"     : renvoie tous les utilisateurs, uniquement si le code
 *                  administrateur est correct (vérifié ICI, côté serveur).
 *   - "delete"   : supprime un utilisateur (code administrateur requis).
 *
 * Stockage : Upstash Redis (gratuit), via son API REST — aucune dépendance npm.
 * Variables d'environnement Vercel (ajoutées automatiquement quand tu
 * connectes Upstash Redis à ton projet, onglet Storage) :
 *     KV_REST_API_URL  et  KV_REST_API_TOKEN
 *   (ou UPSTASH_REDIS_REST_URL  et  UPSTASH_REDIS_REST_TOKEN)
 *
 * Code administrateur : variable ADMIN_CODE (recommandé). À défaut, la valeur
 * ci-dessous est utilisée. Ce fichier tourne sur le serveur : son contenu
 * n'est jamais envoyé au navigateur des visiteurs.
 */

const DEFAULT_ADMIN_CODE = "20112011";
const USERS_KEY = "pm_users";
const MAX_FAILS = 5;            // essais de code ratés avant blocage
const LOCK_SECONDS = 15 * 60;   // durée du blocage (par adresse IP)
const MAX_REGISTER_PER_MIN = 20; // anti-spam des enregistrements (par IP)

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const json = await r.json();
  if (!r.ok || json.error) throw new Error(json.error || `Redis ${r.status}`);
  return json.result;
}

// Comparaison à temps constant (évite de deviner le code par mesure de durée).
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (fwd ? String(fwd).split(",")[0] : req.socket && req.socket.remoteAddress || "?").trim();
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function checkAdmin(req, res, code) {
  const ip = clientIp(req);
  const failKey = `pm_fail:${ip}`;
  const fails = Number(await redis("GET", failKey)) || 0;
  if (fails >= MAX_FAILS) {
    res.status(429).json({ ok: false, error: "Trop d'essais. Réessaie dans 15 minutes." });
    return false;
  }
  const expected = process.env.ADMIN_CODE || DEFAULT_ADMIN_CODE;
  if (!safeEqual(code || "", expected)) {
    await redis("INCR", failKey);
    await redis("EXPIRE", failKey, LOCK_SECONDS);
    await new Promise(r => setTimeout(r, 700));
    res.status(401).json({ ok: false, error: "Code incorrect." });
    return false;
  }
  await redis("DEL", failKey);
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Méthode non autorisée." });
    return;
  }
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(503).json({ ok: false, error: "Stockage non configuré (Upstash Redis manquant sur Vercel)." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  try {
    if (body.action === "register") {
      const email = clean(body.email, 120).toLowerCase();
      if (!EMAIL_RE.test(email)) { res.status(400).json({ ok: false, error: "Email invalide." }); return; }

      const rateKey = `pm_reg:${clientIp(req)}`;
      const count = await redis("INCR", rateKey);
      if (count === 1) await redis("EXPIRE", rateKey, 60);
      if (count > MAX_REGISTER_PER_MIN) { res.status(429).json({ ok: false, error: "Trop de requêtes." }); return; }

      const now = new Date().toISOString();
      let prev = null;
      const raw = await redis("HGET", USERS_KEY, email);
      if (raw) { try { prev = JSON.parse(raw); } catch (e) { prev = null; } }
      const record = {
        email,
        prenom: clean(body.prenom, 60) || (prev && prev.prenom) || "",
        nom: clean(body.nom, 60) || (prev && prev.nom) || "",
        firstSeen: (prev && prev.firstSeen) || now,
        lastSeen: now,
        logins: ((prev && prev.logins) || 0) + 1,
      };
      await redis("HSET", USERS_KEY, email, JSON.stringify(record));
      res.status(200).json({ ok: true });
      return;
    }

    if (body.action === "list") {
      if (!(await checkAdmin(req, res, body.code))) return;
      const flat = (await redis("HGETALL", USERS_KEY)) || [];
      const users = [];
      for (let i = 1; i < flat.length; i += 2) { try { users.push(JSON.parse(flat[i])); } catch (e) {} }
      users.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
      res.status(200).json({ ok: true, total: users.length, users });
      return;
    }

    if (body.action === "delete") {
      if (!(await checkAdmin(req, res, body.code))) return;
      const email = clean(body.email, 120).toLowerCase();
      await redis("HDEL", USERS_KEY, email);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Action inconnue." });
  } catch (err) {
    console.error("api/users :", err);
    res.status(500).json({ ok: false, error: "Erreur serveur." });
  }
}
