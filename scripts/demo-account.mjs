// Crée le compte de démonstration pour la revue Apple et lui ajoute des jetons.
// Usage : BASE_URL=https://www.beloteprestige.com BELOTE_ADMIN_KEY=... DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/demo-account.mjs
// Aucun secret dans le dépôt : tout vient des variables d'environnement.
const { BASE_URL = "http://localhost:3999", BELOTE_ADMIN_KEY, DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME = "Relecteur Apple", DEMO_TOKENS = "50000" } = process.env;
if (!BELOTE_ADMIN_KEY || !DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error("Variables requises : BELOTE_ADMIN_KEY, DEMO_EMAIL, DEMO_PASSWORD");
  process.exit(1);
}
const headers = { "Content-Type": "application/json", Origin: BASE_URL };
const post = async (path, body, extra = {}) => {
  const r = await fetch(BASE_URL + path, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(`${path} : ${data.error ?? r.status}`);
  return data;
};
let view;
try {
  view = await post("/api/auth/register", { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME });
  console.log("Compte créé.");
} catch (e) {
  console.log(`Inscription : ${e.message} (le compte existe peut-être déjà)`);
}
if (view?.id) {
  await post("/api/admin", { type: "playerCredit", id: view.id, amount: Number(DEMO_TOKENS), reason: "Compte de démonstration (revue Apple)" }, { Authorization: `Bearer ${BELOTE_ADMIN_KEY}` });
  console.log(`${DEMO_TOKENS} jetons ajoutés.`);
} else console.log("Jetons non ajoutés : ajoutez-les depuis /admin > Clients.");
