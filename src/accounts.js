// Comptes joueurs communs au site et aux applications mobiles.
// Un compte (e-mail et/ou Apple/Google) est rattaché à un profil joueur :
// pseudo, avatar, statistiques et tables VIP suivent le compte sur tous les appareils.
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const token = () => randomBytes(24).toString("base64url");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function hash(password, salt = token()) {
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}
function same(password, stored) {
  const a = Buffer.from(scryptSync(password, stored.salt, 32).toString("hex"));
  const b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fail(message, status = 400) {
  const e = Error(message);
  e.status = status;
  throw e;
}
export function checkPassword(p) {
  if (typeof p !== "string" || p.length < 8 || p.length > 128)
    fail("Le mot de passe doit contenir 8 à 128 caractères.");
}
export function normalizeEmail(v) {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) fail("Adresse e-mail invalide.");
  return email;
}

// Envoi des e-mails : Resend si configuré (RESEND_API_KEY + BELOTE_MAIL_FROM),
// sinon le message est gardé dans une boîte d'envoi locale et journalisé (développement).
export function createMailer(db, env = process.env) {
  return async function mail(to, subject, text) {
    db.outbox = [...(db.outbox ?? []), { to, subject, text, at: Date.now() }].slice(-50);
    if (env.RESEND_API_KEY && env.BELOTE_MAIL_FROM) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from: env.BELOTE_MAIL_FROM, to, subject, text }),
        });
        if (!r.ok) console.error("Envoi d’e-mail refusé :", r.status);
      } catch (e) {
        console.error("Envoi d’e-mail impossible :", e.message);
      }
    } else console.log(`[e-mail non configuré] ${to} · ${subject}\n${text}`);
  };
}

// Vérification des jetons d'identité Apple / Google (OpenID Connect, RS256).
const PROVIDERS = {
  google: {
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["accounts.google.com", "https://accounts.google.com"],
    audience: (env) => env.GOOGLE_CLIENT_ID,
  },
  apple: {
    jwks: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audience: (env) => env.APPLE_CLIENT_ID,
  },
};
const keyCache = new Map();
async function jwks(url, fetchImpl) {
  const c = keyCache.get(url);
  if (c && Date.now() - c.at < 3600_000) return c.keys;
  const r = await fetchImpl(url);
  if (!r.ok) fail("Service d’identité indisponible.", 502);
  const { keys } = await r.json();
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}
export async function verifyIdToken(provider, idToken, env = process.env, fetchImpl = fetch) {
  const p = PROVIDERS[provider];
  if (!p) fail("Fournisseur inconnu.");
  const aud = p.audience(env);
  if (!aud) fail(`Connexion ${provider === "apple" ? "Apple" : "Google"} non configurée sur ce serveur.`, 501);
  if (typeof idToken !== "string" || idToken.length > 4096) fail("Jeton invalide.");
  const [h, b, s] = idToken.split(".");
  if (!s) fail("Jeton invalide.");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  const claims = JSON.parse(Buffer.from(b, "base64url"));
  if (header.alg !== "RS256") fail("Jeton invalide.");
  const jwk = (await jwks(p.jwks, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) fail("Clé de signature inconnue.");
  const ok = createVerify("RSA-SHA256")
    .update(`${h}.${b}`)
    .verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  const audOk = [aud]
    .flat()
    .flatMap((a) => String(a).split(","))
    .includes(claims.aud);
  if (!ok || !p.issuers.includes(claims.iss) || !audOk || claims.exp * 1000 < Date.now())
    fail("Jeton refusé.", 401);
  return {
    sub: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}

export function createAccounts({ db, mail, baseUrl, newPlayer, retirePlayer }) {
  db.accounts ??= {};
  db.sessions ??= {};
  db.tokens ??= {};
  const byEmail = (email) => Object.values(db.accounts).find((a) => a.email === email);
  function session(player) {
    const t = token();
    db.sessions[sha(t)] = { playerId: player.id, at: Date.now() };
    return t;
  }
  function issue(kind, accountId, ttl) {
    const t = token();
    for (const [k, v] of Object.entries(db.tokens))
      if (v.expires < Date.now() || (v.kind === kind && v.accountId === accountId))
        delete db.tokens[k];
    db.tokens[sha(t)] = { kind, accountId, expires: Date.now() + ttl };
    return t;
  }
  function take(kind, t) {
    const k = sha(String(t ?? ""));
    const v = db.tokens[k];
    if (!v || v.kind !== kind || v.expires < Date.now()) fail("Lien invalide ou expiré.");
    delete db.tokens[k];
    return db.accounts[v.accountId] ?? fail("Compte introuvable.");
  }
  async function sendVerification(acc, req) {
    const t = issue("verify", acc.id, 48 * 3600_000);
    await mail(
      acc.email,
      "Confirmez votre adresse — Maison Belote",
      `Bienvenue à la Maison Belote !\n\nConfirmez votre adresse en ouvrant ce lien :\n${baseUrl(req)}/api/auth/verify?token=${t}\n\nCe lien est valable 48 heures.`,
    );
  }
  // Fusion douce : un invité qui se connecte à un compte existant lui apporte ses parties.
  function adopt(account, guest) {
    const p = db.players[account.playerId];
    if (guest && guest.id !== p.id && !guest.accountId) {
      p.stats.games += guest.stats.games;
      p.stats.wins += guest.stats.wins;
      p.history = [...guest.history, ...p.history].sort((a, b) => b.date - a.date).slice(0, 30);
      if (!p.tableId && guest.tableId) {
        // La place de l'invité passe au compte.
        const t = db.tables[guest.tableId];
        const s = t?.seats.find((s) => s?.id === guest.id);
        if (s) {
          s.id = p.id;
          if (t.owner === guest.id) t.owner = p.id;
          p.tableId = t.id;
        }
      }
      retirePlayer(guest);
    }
    return p;
  }
  return {
    session,
    resolve(raw) {
      const s = raw && db.sessions[sha(raw)];
      return s ? db.players[s.playerId] : null;
    },
    view(p) {
      const a = p.accountId && db.accounts[p.accountId];
      return a
        ? { email: a.email, verified: a.verified, providers: Object.keys(a.providers ?? {}), hasPassword: !!a.password }
        : null;
    },
    async register(guest, d, req) {
      const email = normalizeEmail(d.email);
      checkPassword(d.password);
      if (byEmail(email)) fail("Un compte existe déjà avec cette adresse. Connectez-vous.");
      const p = guest.accountId ? newPlayer() : guest;
      const acc = {
        id: token(),
        email,
        password: hash(d.password),
        verified: false,
        providers: {},
        playerId: p.id,
        created: Date.now(),
      };
      db.accounts[acc.id] = acc;
      p.accountId = acc.id;
      await sendVerification(acc, req);
      return p;
    },
    login(guest, d) {
      const email = normalizeEmail(d.email);
      const acc = byEmail(email);
      if (!acc?.password || typeof d.password !== "string" || !same(d.password, acc.password))
        fail("Adresse ou mot de passe incorrect.", 401);
      if (db.players[acc.playerId]?.banned) fail("Profil suspendu.", 403);
      return adopt(acc, guest);
    },
    async oidc(guest, d) {
      const info = await verifyIdToken(d.provider, d.idToken);
      let acc = Object.values(db.accounts).find((a) => a.providers?.[d.provider] === info.sub);
      if (!acc && info.email && info.emailVerified) acc = byEmail(info.email);
      if (!acc) {
        const p = guest.accountId ? newPlayer() : guest;
        acc = {
          id: token(),
          email: info.email,
          password: null,
          verified: !!info.emailVerified,
          providers: {},
          playerId: p.id,
          created: Date.now(),
        };
        db.accounts[acc.id] = acc;
        p.accountId = acc.id;
      }
      acc.providers = { ...acc.providers, [d.provider]: info.sub };
      if (info.emailVerified && acc.email === info.email) acc.verified = true;
      return adopt(acc, guest);
    },
    verify(t) {
      const acc = take("verify", t);
      acc.verified = true;
      return acc;
    },
    async resend(p, req) {
      const acc = db.accounts[p.accountId] ?? fail("Aucun compte.");
      if (!acc.verified) await sendVerification(acc, req);
    },
    async forgot(d, req) {
      const acc = byEmail(normalizeEmail(d.email));
      if (!acc) return; // Réponse identique : on ne révèle pas l'existence d'un compte.
      const t = issue("reset", acc.id, 3600_000);
      await mail(
        acc.email,
        "Nouveau mot de passe — Maison Belote",
        `Pour choisir un nouveau mot de passe, ouvrez ce lien :\n${baseUrl(req)}/#reset=${t}\n\nCe lien est valable une heure. Ignorez ce message si vous n’êtes pas à l’origine de la demande.`,
      );
    },
    reset(d) {
      checkPassword(d.password);
      const acc = take("reset", d.token);
      acc.password = hash(d.password);
      acc.verified = true; // le lien prouve l'accès à la boîte.
      // Toutes les sessions existantes sont révoquées.
      for (const [k, s] of Object.entries(db.sessions))
        if (s.playerId === acc.playerId) delete db.sessions[k];
      return db.players[acc.playerId];
    },
    changePassword(p, d) {
      const acc = db.accounts[p.accountId] ?? fail("Aucun compte.");
      if (acc.password && !(typeof d.current === "string" && same(d.current, acc.password)))
        fail("Mot de passe actuel incorrect.", 401);
      checkPassword(d.password);
      acc.password = hash(d.password);
    },
    remove(p, d) {
      const acc = db.accounts[p.accountId] ?? fail("Aucun compte.");
      if (acc.password && !(typeof d.password === "string" && same(d.password, acc.password)))
        fail("Mot de passe incorrect.", 401);
      delete db.accounts[acc.id];
      for (const [k, v] of Object.entries(db.tokens)) if (v.accountId === acc.id) delete db.tokens[k];
      for (const [k, s] of Object.entries(db.sessions)) if (s.playerId === p.id) delete db.sessions[k];
      retirePlayer(p);
    },
    logout(raw) {
      if (raw) delete db.sessions[sha(raw)];
    },
  };
}
