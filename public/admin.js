// Back-office (page /admin) : chargé à la demande, jamais pour les joueurs.
// Exporte `initAdmin` (affichage de la page), `adminAction` (clics) et `adminSubmit` (formulaires).
import { $, e, fmt, btn, toast, modal, when, myTz, avatar } from "./ui.js";

// Back-office : jetons créés / détruits et indicateurs (7 derniers jours).
const SOURCE_NAMES = { achat: "Boutique (objets)", signup: "Inscription", login: "Roue du jour", referral: "Parrainage", tournoi: "Tournois", purchase: "Achats", win: "Gains de parties", loss: "Pertes de parties", fee: "Droit de table", refund: "Remboursements", dispute: "Oppositions", admin: "Back-office", challenge: "Défis", defi: "Défis", cancel: "Annulations" };
function metricsCard(m) {
  const pct = (v) => (v == null ? "—" : `${v} %`);
  const row = (label, c, d) => `<tr><td>${e(label)}</td><td class="plus">+${fmt(c)}</td><td class="minus">−${fmt(d)}</td><td>${c - d >= 0 ? "+" : "−"}${fmt(Math.abs(c - d))}</td></tr>`;
  return `<div class="admin-card"><b>📊 Indicateurs (7 jours)</b>
    <p class="muted small">Retour J1 ${pct(m.j1)} · retour J7 ${pct(m.j7)} · partie moyenne ${m.gameMinutes == null ? "—" : `${String(m.gameMinutes).replace(".", ",")} min`} · joueurs payants ${String(m.payingShare).replace(".", ",")} %</p>
    <table class="metrics"><thead><tr><th>Jour</th><th>Créés</th><th>Détruits</th><th>Solde</th></tr></thead><tbody>${m.days.map((x) => row(x.day.slice(8, 10) + "/" + x.day.slice(5, 7), x.created, x.destroyed)).join("") || '<tr><td colspan="4">Aucun mouvement</td></tr>'}</tbody></table>
    <table class="metrics"><thead><tr><th>Source</th><th>Créés</th><th>Détruits</th><th>Solde</th></tr></thead><tbody>${m.sources.map((x) => row(SOURCE_NAMES[x.type] ?? x.type, x.created, x.destroyed)).join("")}</tbody></table></div>`;
}

let adminToken = "",
  adminData = null;
// ———————————————— administration des tournois : calendrier et programmation
const TOUR_LABELS = { draft: "Brouillon", published: "Publié", running: "En cours", finished: "Terminé", cancelled: "Annulé" };
function tourAdmin(d) {
  const byDay = {};
  for (const t of d.tournaments) (byDay[new Date(t.start).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })] ??= []).push(t);
  return `<p class="muted small">Push navigateur ${d.push.web ? "✓ configuré" : "— clés VAPID manquantes"} · push iOS/Android ${d.push.native ? "✓ configuré" : "— Firebase non configuré"} · les rappels restent dans l’application dans tous les cas.</p>
    ${btn("＋ Nouveau tournoi", "tourNew", "pill small")}
    <div class="tour-cal">${Object.entries(byDay).map(([day, list]) => `<div class="cal-day"><b>${e(day)}</b>${list.map((t) => `<div class="admin-card"><b>${e(t.name)}</b><small>${new Date(t.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} (votre heure) · ${e(t.local.start.replace("T", " "))} ${e(t.timeZone)} · ${TOUR_LABELS[t.status]} · ${t.places.used}/${t.places.capacity} inscrits${t.places.waitlist ? ` · ${t.places.waitlist} en attente` : ""}</small>
      <div class="row">${["draft", "published"].includes(t.status) && !t.rounds ? btn("Modifier", "tourEdit", "chip-btn", `data-id="${t.id}"`) : ""}${t.status === "draft" ? btn("Publier", "tourPublish", "chip-btn", `data-id="${t.id}"`) : ""}${["draft", "published"].includes(t.status) ? btn("Reporter", "tourPostpone", "chip-btn", `data-id="${t.id}"`) + btn("Annuler", "tourCancel", "chip-btn danger", `data-id="${t.id}"`) : ""}${btn("Dupliquer", "tourDuplicate", "chip-btn", `data-id="${t.id}"`)}${["finished", "cancelled", "draft"].includes(t.status) ? btn("Supprimer", "tourDelete", "chip-btn danger", `data-id="${t.id}"`) : ""}${btn("Détails", "tourDetails", "chip-btn", `data-id="${t.id}"`)}</div></div>`).join("")}</div>`).join("") || "<p>Aucun tournoi programmé.</p>"}</div>`;
}
function tourForm(t) {
  const d = adminData;
  const now = new Date(Date.now() + 86400_000);
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const n0 = new Date();
  const nowLocal = `${n0.getFullYear()}-${pad(n0.getMonth() + 1)}-${pad(n0.getDate())}T${pad(n0.getHours())}:${pad(n0.getMinutes())}`; // inscriptions ouvertes dès la publication
  const v = t
    ? { ...t, ...t.local }
    : { name: "", description: "", timeZone: myTz(), teams: 8, minTeams: 4, minBalance: 0, rules: { target: 1500, turnSeconds: 20, flyingCounter: true, reconnectSeconds: 120, forfeitSeconds: 300 }, insufficient: "postpone", postponeMinutes: 30, rewards: { winner: ["tournoi-vainqueur", "frame-champion"], finalist: ["tournoi-finaliste"], participant: ["tournoi-participant"] }, regOpen: nowLocal, regClose: `${day}T20:00`, confirmBy: `${day}T20:50`, start: `${day}T21:00` };
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([val, label]) => `<option value="${val}" ${String(val) === String(cur) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  const rw = (kind, label) => `<fieldset><legend>${label}</legend>${d.rewards.map((r) => `<label class="check-line"><input type="checkbox" name="rw-${kind}" value="${r.id}" ${v.rewards[kind].includes(r.id) ? "checked" : ""}>${e(r.name)}</label>`).join("")}</fieldset>`;
  $("#admin-tours").innerHTML = `<form id="tour-form" class="form">
    <input type="hidden" name="tid" value="${t?.id ?? ""}">
    <label>Nom<input name="name" value="${e(v.name)}" minlength="3" maxlength="60" required></label>
    <label>Description<input name="description" value="${e(v.description ?? "")}" maxlength="400"></label>
    <fieldset class="prize-box"><legend>💰 Jetons gagnés (par joueur de l’équipe, offerts par la Maison)</legend><div class="form-grid"><label>🏆 Vainqueurs<input type="number" name="prizeWinner" min="0" max="1000000" step="1" value="${v.prizes?.winner ?? 0}"></label><label>🥈 Finalistes<input type="number" name="prizeFinalist" min="0" max="1000000" step="1" value="${v.prizes?.finalist ?? 0}"></label></div></fieldset>
    <fieldset class="prize-box"><legend>🎟️ Tournoi payant en jetons (cagnotte : 70 % vainqueurs, 30 % finalistes)</legend><div class="form-grid"><label>Droit d’entrée par joueur (0 = gratuit)<input type="number" name="entryFee" min="0" max="100000" step="1" value="${v.entryFee ?? 0}"></label><label>Part de la Maison (%)<input type="number" name="houseCut" min="10" max="20" step="1" value="${v.houseCut ?? 15}"></label></div></fieldset>
    <label>Fuseau de référence<input name="timeZone" value="${e(v.timeZone)}" list="tz-list" required></label>
    <datalist id="tz-list">${["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "America/Montreal", "Indian/Reunion", "America/Martinique", "Pacific/Noumea", "UTC"].map((z) => `<option value="${z}">`).join("")}</datalist>
    <div class="form-grid">
      <label>Ouverture des inscriptions<input type="datetime-local" name="regOpen" value="${v.regOpen}" required></label>
      <label>Fermeture des inscriptions<input type="datetime-local" name="regClose" value="${v.regClose}" required></label>
      <label>Fin de la confirmation de présence<input type="datetime-local" name="confirmBy" value="${v.confirmBy}" required></label>
      <label>Départ<input type="datetime-local" name="start" value="${v.start}" required></label>
      <label>Équipes${sel("teams", [[8, "8 équipes"], [16, "16 équipes"], [32, "32 équipes"]], v.teams)}</label>
      <label>Minimum pour lancer<input type="number" name="minTeams" min="2" max="32" value="${v.minTeams}"></label>
      <label>Seuil de jetons<input type="number" name="minBalance" min="0" step="1000" value="${v.minBalance}"></label>
      <label>Score cible${sel("target", [[500, "500"], [1000, "1 000"], [1500, "1 500"], [2000, "2 000"]], v.rules.target)}</label>
      <label>Temps par tour (s)<input type="number" name="turnSeconds" min="10" max="120" value="${v.rules.turnSeconds}"></label>
      <label>Reprise après coupure (s)<input type="number" name="reconnectSeconds" min="30" max="600" value="${v.rules.reconnectSeconds}"></label>
      <label>Forfait après absence (s)<input type="number" name="forfeitSeconds" min="30" max="1800" value="${v.rules.forfeitSeconds}"></label>
      <label>Équipes insuffisantes${sel("insufficient", [["postpone", "Reporter"], ["cancel", "Annuler"], ["bots", "Compléter avec des robots"]], v.insufficient)}</label>
      <label>Rappel avant le départ (heures)<input type="number" name="reminderHours" min="0" max="48" value="${v.reminderHours ?? 3}"></label>
      <label>Report de (min)<input type="number" name="postponeMinutes" min="5" max="10080" value="${v.postponeMinutes}"></label>
    </div>
    <label class="check-line"><input type="checkbox" name="flyingCounter" ${v.rules.flyingCounter ? "checked" : ""}>Contrée à la volée</label>
    ${rw("winner", "Récompenses des vainqueurs")}${rw("finalist", "Récompenses des finalistes")}${rw("participant", "Récompenses de participation")}
    <p class="muted small">Après le départ, seuls le nom et la description restent modifiables.</p>
    <div class="row"><button class="chip-btn" name="publish" value="">Enregistrer le brouillon</button><button class="pill small" name="publish" value="1">${t?.status === "published" ? "Enregistrer" : "Publier"}</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div>
  </form>`;
}
// ———————————————— back office : clients
let adminClient = null,
  adminTab = "dash";
function clientList(d) {
  const players = [...d.players].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  return `<input id="client-search" class="client-search" type="search" placeholder="Rechercher un pseudo ou un e-mail" autocomplete="off">
    <div class="client-list">${players.map((p) => `<div class="admin-row client-row" data-q="${e((p.name + " " + (p.account?.email ?? "") + " " + (p.tag ?? "")).toLowerCase())}"><span>${p.online ? "🟢" : "⚪"} <b>${e(p.name)}</b> <small>${e(p.account?.email ?? "invité")}${p.banned ? " · suspendu" : ""}</small></span><span class="row"><small>🪙 ${fmt(p.wallet.balance / 2)}</small>${btn("Fiche", "clientOpen", "chip-btn", `data-id="${p.id}"`)}</span></div>`).join("") || "<p>Aucun client.</p>"}</div>`;
}
async function openClient(id) {
  try {
    const res = await fetch("/api/admin?player=" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + adminToken } });
    if (!res.ok) throw Error(await res.text());
    const c = await res.json();
    adminClient = id;
    const box = $("#admin-clients");
    if (!box) return;
    const w = c.wallet;
    box.innerHTML = `<div class="client-sheet">
      <div class="row">${btn("← Liste des clients", "clientBack", "chip-btn ghost")}</div>
      <div class="client-head">${avatar(c.avatar)}<div><b>${e(c.name)}</b><small>${e(c.tag ?? "")} · ${c.online ? "en ligne" : "hors ligne"}${c.banned ? " · <b>suspendu</b>" : ""}</small><small>${c.account ? `${e(c.account.email)} · ${c.account.verified ? "e-mail vérifié" : "e-mail non vérifié"}${c.account.providers.length ? " · " + c.account.providers.map(e).join(", ") : ""}` : "Invité sans compte"}</small></div></div>
      <div class="admin-stats"><div><b>${fmt(w.balance / 2)}</b><small>solde</small></div><div><b>${fmt(w.reserved / 2)}</b><small>engagés</small></div><div><b>${c.stats.games}</b><small>parties</small></div><div><b>${c.stats.wins ?? 0}</b><small>victoires</small></div></div>
      <h4>Ajouter / retirer des jetons</h4>
      <div class="row">${c.account ? `${c.prestige ? `<small>⭐ Prestige jusqu’au ${new Date(c.prestige.until).toLocaleDateString("fr-FR")}</small>` : ""}${btn("⭐ Prestige +30 j", "adminPrestige", "chip-btn", `data-id="${c.id}" data-days="30"`)}${c.prestige ? btn("Retirer Prestige", "adminPrestige", "chip-btn", `data-id="${c.id}" data-days="0"`) : ""}` : ""}</div>
      <form id="client-credit-form" class="form inline"><input type="hidden" name="cid" value="${c.id}"><label>Montant (jetons, négatif pour retirer)<input name="amount" type="number" step="0.5" min="-1000000" max="1000000" required></label><label>Motif<input name="reason" maxlength="120" placeholder="Geste commercial, correction…"></label><button class="pill small">Valider</button></form>
      <h4>Fiche</h4>
      <form id="client-edit-form" class="form"><input type="hidden" name="cid" value="${c.id}">
        <div class="form-grid"><label>Pseudo<input name="name" value="${e(c.name)}" minlength="2" maxlength="24" required></label><label>Avatar<input name="avatar" value="${e(c.avatar)}" maxlength="8"></label>
        ${c.account ? `<label>E-mail<input name="email" type="email" value="${e(c.account.email)}" required></label><label class="check-line"><input type="checkbox" name="verified" ${c.account.verified ? "checked" : ""}>E-mail vérifié</label><label>Nouveau mot de passe <small class="muted">(laisser vide pour ne pas changer)</small><input name="password" type="text" minlength="8" maxlength="128" autocomplete="off"></label>` : ""}</div>
        <button class="pill small">Enregistrer la fiche</button></form>
      <div class="row">${btn(c.banned ? "Réactiver le compte" : "Suspendre le compte", "clientSuspend", "chip-btn", `data-id="${c.id}" data-enabled="${!c.banned}"`)}${btn("Supprimer le client", "clientDelete", "chip-btn danger", `data-id="${c.id}" data-name="${e(c.name)}"`)}</div>
      <h4>Journal des jetons</h4>
      <div class="client-ledger">${c.ledger.map((x) => `<div class="admin-row"><span>${when(x.at)} · ${e(x.label ?? x.type)}</span><span class="${x.amount < 0 ? "neg" : "pos"}">${x.amount > 0 ? "+" : ""}${fmt(x.amount)} → ${fmt(x.balance)}</span></div>`).join("") || "<p class='muted small'>Aucun mouvement.</p>"}</div>
      <h4>Dernières parties</h4>
      <div>${(c.history ?? []).slice(0, 15).map((h) => `<div class="admin-row"><span>${h.at ? when(h.at) : ""} ${e(h.table ?? h.name ?? "")}</span><span>${h.won ? "Gagnée" : "Perdue"}${h.score ? ` · ${e(String(h.score))}` : ""}</span></div>`).join("") || "<p class='muted small'>Aucune partie.</p>"}</div>
    </div>`;
  } catch (err) {
    adminClient = null;
    toast(err.message);
  }
}
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "client-search") return;
  const q = ev.target.value.trim().toLowerCase();
  for (const r of document.querySelectorAll(".client-row")) r.hidden = !!q && !r.dataset.q.includes(q);
});
// Sauvegarde : téléchargement immédiat et état de la copie automatique de chaque nuit.
function backupCard(b) {
  const last = b?.last;
  const status = !b?.configured
    ? "Copie automatique non configurée (stockage externe à ajouter dans Railway)."
    : last
      ? `Dernière copie automatique : ${new Date(last.at).toLocaleString("fr-FR")} · ${last.ok ? "✅ réussie" : `❌ échec : ${e(last.error ?? "")}`}`
      : "Copie automatique configurée : première copie cette nuit.";
  return `<div class="admin-card"><b>💾 Sauvegarde des données</b><p class="muted small">${status}</p>
    <div class="row">${btn("Télécharger une sauvegarde", "backupDownload", "chip-btn")}${b?.configured ? btn("Sauvegarder maintenant", "backupNow", "chip-btn") : ""}</div></div>`;
}
async function adminRequest(data) {
  try {
    const res = await fetch("/api/admin", {
      method: data ? "POST" : "GET",
      headers: { Authorization: "Bearer " + adminToken, ...(data ? { "Content-Type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw Error(await res.text());
    const d = await res.json();
    adminData = d;
    const row = (l, r) => `<div class="admin-row"><span>${l}</span>${r}</div>`;
    const open = d.reports.filter((r) => !r.resolved);
    const alerts = d.alerts.filter((x) => !x.reviewed);
    const online = d.players.filter((p) => p.online).length;
    const upcoming = d.tournaments.filter((t) => ["draft", "published", "running"].includes(t.status));
    const tabs = [
      ["dash", "📊", "Tableau de bord"],
      ["clients", "👥", `Clients`, d.players.length],
      ["tours", "🏆", "Tournois", upcoming.length],
      ["moderation", "🚩", "Modération", open.length + alerts.length],
      ["boutique", "🛍️", "Boutique"],
      ["tables", "🃏", "Tables", d.tables.length],
      ["settings", "⚙️", "Réglages"],
    ];
    const panel = (id, html) => `<section class="admin-panel" data-panel="${id}" ${adminTab === id ? "" : "hidden"}>${html}</section>`;
    $("#admin-result").innerHTML = `
      ${d.storage?.ephemeral ? '<p class="warn">⚠️ Données temporaires : aucun volume n’est attaché au service Railway. Ajoutez un volume (Railway › service › Settings › Volumes, point de montage /data).</p>' : ""}
      <nav class="admin-tabs">${tabs.map(([id, ic, label, n]) => `<button type="button" class="admin-tab ${adminTab === id ? "on" : ""}" data-action="adminTab" data-tab="${id}"><span>${ic}</span>${label}${n ? `<i>${n}</i>` : ""}</button>`).join("")}</nav>
      <div class="admin-body">
      ${panel("dash", `<h2>Tableau de bord</h2>
        <div class="admin-stats"><div><b>${d.players.length}</b><small>clients</small></div><div><b>${online}</b><small>en ligne</small></div><div><b>${d.tables.length}</b><small>tables</small></div><div><b>${upcoming.length}</b><small>tournois à venir</small></div><div><b>${fmt(d.economy.circulating)}</b><small>jetons en circulation</small></div><div><b>${fmt(d.economy.reserved)}</b><small>jetons engagés</small></div><div><b>${open.length}</b><small>signalements</small></div><div><b>${alerts.length}</b><small>alertes</small></div></div>
        <p class="muted small">Achats ${d.economy.purchases ? "ouverts" : "fermés"} (web ${d.economy.stripe ? "✓" : "—"}, iOS ${d.economy.apple ? "✓" : "—"}, Android ${d.economy.google ? "✓" : "—"}) · Push navigateur ${d.push.web ? "✓" : "—"} · Push natif ${d.push.native ? "✓" : "—"} · Entrées ${d.settings.maintenance ? "suspendues" : "ouvertes"}</p>
        ${backupCard(d.backup)}
        ${d.metrics ? metricsCard(d.metrics) : ""}
        ${d.purchasesSummary ? `<div class="admin-card"><b>🧾 Registre des achats</b><p class="muted small">${d.purchasesSummary.paid} payé${d.purchasesSummary.paid > 1 ? "s" : ""} · ${d.purchasesSummary.reversed} remboursé${d.purchasesSummary.reversed > 1 ? "s" : ""} ou contesté${d.purchasesSummary.reversed > 1 ? "s" : ""} · ${(d.purchasesSummary.revenueCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}${d.purchasesSummary.owed ? ` · ${fmt(d.purchasesSummary.owed)} jetons non repris` : ""} · achats ${d.economy.purchases ? "ouverts" : "fermés"}</p>${d.economy.stripe ? btn("Réimporter les paiements Stripe (30 jours)", "purchasesResync", "chip-btn") : ""}</div>` : ""}
        <p class="muted small">Stockage : ${d.storage.kind === "sqlite" ? "base SQLite" : "fichier JSON"}${d.storage.migration ? ` · migration du ${new Date(d.storage.migration.at).toLocaleString("fr-FR")} ${d.storage.migration.ok ? "✅" : "❌"} (${d.storage.migration.players} joueurs, ${d.storage.migration.ledger} mouvements, ${fmt(d.storage.migration.balance / 2)} jetons)` : ""}</p>`)}
      ${panel("clients", `<h2>Clients</h2><div id="admin-clients">${clientList(d)}</div>`)}
      ${panel("tours", `<h2>Tournois</h2><div id="admin-tours">${tourAdmin(d)}</div>`)}
      ${panel("moderation", `<h2>Modération</h2><h3>Alertes à examiner</h3><p class="muted small">Indices combinés, jamais une preuve : aucune sanction automatique.</p>
      ${alerts.map((x) => `<div class="admin-card"><b>${e(x.kind)}</b><small>${when(x.at)} · ${x.names.map(e).join(", ")}</small><ul>${x.indicators.map((i) => `<li>${e(i)}</li>`).join("")}</ul>${btn("Marquer comme examinée", "reviewAlert", "chip-btn", `data-id="${x.id}"`)}</div>`).join("") || "<p>Aucune alerte.</p>"}
      <h3>Signalements</h3>
      ${open.map((r) => `<div class="admin-card"><b>${e(r.reason)}${r.targetName ? ` · ${e(r.targetName)}` : ""}</b><small>${when(r.at)} · par ${e(r.byName ?? r.by)}${r.gameId ? ` · partie ${e(r.gameId.slice(0, 8))}, donne ${r.deal ?? "—"}` : ""}</small>${r.comment ? `<p>${e(r.comment)}</p>` : ""}${r.context?.chat?.length ? `<p class="muted small">Messages : ${r.context.chat.map((m) => e(m.text)).join(" · ")}</p>` : ""}${r.context?.reactions?.length ? `<p class="muted small">${r.context.reactions.length} réaction(s) récente(s)</p>` : ""}${btn("Traiter", "resolveReport", "chip-btn", `data-id="${r.id}"`)}</div>`).join("") || "<p>Aucun signalement ouvert.</p>"}`)}
      ${panel("boutique", `<h2>Boutique</h2><p class="muted small">Nom, prix (jetons), ordre d’affichage et visibilité. Un article masqué reste acquis à ceux qui le possèdent.</p>
        <div class="shop-admin">${d.shop.map((it) => `<form class="form inline shop-item-form" data-id="${it.id}"><img src="${it.img}" alt=""><label>Nom<input name="name" value="${e(it.name)}" maxlength="40" required></label><label>Prix<input name="price" type="number" min="0" max="1000000" value="${it.price}" required></label><label>Ordre<input name="order" type="number" step="1" value="${it.order}"></label><label class="check-line"><input type="checkbox" name="hidden" ${it.hidden ? "checked" : ""}>Masqué</label><button class="pill small">Enregistrer</button></form>`).join("")}</div>`)}
      ${panel("tables", `<h2>Tables</h2>${d.tables.map((t) => row(`${e(t.name)} · ${e(t.status)}${t.stake ? ` · 🪙 ${t.stake}` : ""}`, t.engaged ? btn("Annuler (incident)", "cancelGame", "chip-btn danger", `data-id="${t.id}"`) : btn("Supprimer", "deleteTable", "chip-btn", `data-id="${t.id}"`, t.status === "Partie en cours"))).join("") || "<p>Aucune table.</p>"}`)}
      ${panel("settings", `<h2>Réglages</h2>
        <div class="admin-card"><h3>Envoyer une notification</h3><form id="broadcast-form" class="form"><label>Titre<input name="title" maxlength="60" value="🏆 Tournoi ce soir" required></label><label>Message<input name="body" maxlength="180" placeholder="Le tournoi démarre à 21 h, inscrivez-vous !" required></label><label>Destinataires<select name="audience"><option value="all">Tous les joueurs</option><option value="online">Joueurs en ligne</option></select></label><button class="pill small">Envoyer</button></form></div>
        <div class="admin-card"><b>Nouvelles entrées</b><small>Bloque l’arrivée de nouveaux joueurs aux tables (maintenance).</small>${btn(d.settings.maintenance ? "Rouvrir les entrées" : "Suspendre les nouvelles entrées", "maintenance", "chip-btn", `data-enabled="${!d.settings.maintenance}"`)}</div>
        <div class="admin-card"><form id="bonus-form" class="form inline"><label>Bonus de connexion (jetons / 24 h)<input name="amount" type="number" min="0" max="100000" step="1" value="${d.settings.loginBonus ?? d.economy.loginBonus}" required></label><button class="pill small">Enregistrer</button></form></div>`)}
      </div>`;
    if (adminClient) await openClient(adminClient);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

// Clics du back-office (la page principale délègue ici les actions listées dans ADMIN_ACTIONS).
export async function adminAction(a, el, ev) {
  switch (a) {
    case "tourNew":
      tourForm(null);
      break;
    case "tourEdit":
      tourForm(adminData.tournaments.find((x) => x.id === el.dataset.id));
      break;
    case "tourAdminBack":
      $("#admin-tours").innerHTML = tourAdmin(adminData);
      break;
    case "tourPublish":
      await adminRequest({ type: "tourPublish", id: el.dataset.id });
      break;
    case "purchasesResync":
      await adminRequest({ type: "purchasesResync", days: 30 });
      toast("Paiements Stripe réimportés (sans doublon)");
      break;
    case "tourDelete": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      if (t && confirm(`Supprimer définitivement « ${t.name} » ? Les trophées 🏆 de ses vainqueurs sont conservés.`)) {
        await adminRequest({ type: "tourDelete", id: t.id });
        toast("Tournoi supprimé");
      }
      break;
    }
    case "tourDuplicate":
      await adminRequest({ type: "tourDuplicate", id: el.dataset.id });
      toast("Copie créée en brouillon");
      break;
    case "tourPostpone": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<form id="tour-postpone-form" class="form"><input type="hidden" name="tid" value="${t.id}"><p><b>${e(t.name)}</b> · départ actuel ${e(t.local.start.replace("T", " "))} (${e(t.timeZone)})</p><label>Nouveau départ (${e(t.timeZone)})<input type="datetime-local" name="start" value="${t.local.start}" required></label><p class="muted small">Toutes les dates sont décalées d’autant ; rappels reprogrammés et inscrits informés.</p><div class="row"><button class="pill small">Reporter</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div></form>`;
      break;
    }
    case "tourCancel": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<form id="tour-cancel-form" class="form"><input type="hidden" name="tid" value="${t.id}"><p>Annuler <b>${e(t.name)}</b> ? Les ${t.places.used} inscrits seront prévenus.</p><label>Motif<input name="reason" maxlength="200" value="Annulé par l’organisateur"></label><div class="row"><button class="pill small danger">Annuler le tournoi</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div></form>`;
      break;
    }
    case "tourDetails": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<p><b>${e(t.name)}</b> · ${TOUR_LABELS[t.status]}</p><h4>Inscriptions</h4><ul class="admin-list">${t.regs.map((r) => `<li>${r.names.map(e).join(" & ")}${r.partnerName ? ` (+ ${e(r.partnerName)} invité)` : ""}${r.waitlist ? " · liste d’attente" : ""} · présence ${r.confirmed.length}/${r.names.length}</li>`).join("") || "<li>Aucune</li>"}</ul>
        <h4>Journal</h4><ul class="admin-list">${t.log.slice().reverse().map((l) => `<li>${when(l.at)} · ${e(l.kind)} · ${e(l.by)}</li>`).join("")}</ul>${btn("Retour", "tourAdminBack", "chip-btn ghost")}`;
      break;
    }
    case "adminPrestige":
      adminRequest({ type: "prestige", id: el.dataset.id, days: Number(el.dataset.days) });
      break;
    case "admin":
      modal('<h2>Administration</h2><p class="muted">Accès réservé (clé BELOTE_ADMIN_KEY du serveur).</p><form id="admin-form" class="form"><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="pill small">Ouvrir</button></form><div id="admin-result"></div>', "sheet-modal admin-modal");
      break;
    case "adminTab":
      adminTab = el.dataset.tab;
      for (const b of document.querySelectorAll(".admin-tab")) b.classList.toggle("on", b.dataset.tab === adminTab);
      for (const p of document.querySelectorAll(".admin-panel")) p.hidden = p.dataset.panel !== adminTab;
      break;
    case "adminLogout":
      try {
        localStorage.removeItem("adminKey");
      } catch {}
      location.reload();
      break;
    case "clientOpen":
      await openClient(el.dataset.id);
      break;
    case "clientBack":
      adminClient = null;
      if ($("#admin-clients")) $("#admin-clients").innerHTML = clientList(adminData);
      break;
    case "clientSuspend":
      await adminRequest({ type: "suspend", id: el.dataset.id, enabled: el.dataset.enabled === "true" });
      break;
    case "clientDelete":
      if (confirm(`Supprimer définitivement « ${el.dataset.name} » ? Compte, jetons et historique seront effacés.`)) {
        adminClient = null;
        if (await adminRequest({ type: "playerDelete", id: el.dataset.id })) toast("Client supprimé");
      }
      break;
    case "suspendPlayer":
      await adminRequest({ type: "suspend", id: el.dataset.id, enabled: el.dataset.enabled === "true" });
      break;
    case "deleteTable":
      await adminRequest({ type: "deleteTable", id: el.dataset.id });
      break;
    case "backupDownload": {
      const res = await fetch("/api/admin?download=1", { headers: { Authorization: "Bearer " + adminToken } });
      if (!res.ok) return toast("Téléchargement impossible");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = `belote-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      break;
    }
    case "backupNow":
      await adminRequest({ type: "backupNow" });
      toast("Sauvegarde lancée");
      setTimeout(() => adminRequest(), 3000);
      break;
    case "reviewAlert":
      await adminRequest({ type: "reviewAlert", id: el.dataset.id });
      break;
    case "cancelGame":
      if (confirm("Annuler cette partie ? Les jetons engagés seront libérés sans gain ni perte.")) await adminRequest({ type: "cancelGame", id: el.dataset.id });
      break;
    case "resolveReport":
      await adminRequest({ type: "resolve", id: el.dataset.id });
      break;
    case "maintenance":
      await adminRequest({ type: "maintenance", enabled: el.dataset.enabled === "true" });
      break;
  }
}

// Formulaires du back-office (la page principale délègue ici : formulaire d'article, ADMIN_FORMS).
export async function adminSubmit(f, d) {
  try {
  if (f.classList.contains("shop-item-form")) {
    if (await adminRequest({ type: "shopItem", id: f.dataset.id, name: d.name, price: Number(d.price), order: Number(d.order), hidden: d.hidden === "on" })) toast("Article enregistré");
    return;
  }
    switch (f.id) {
      case "tour-form": {
        const f2 = new FormData(f);
        const data = {
          name: d.name,
          description: d.description,
          timeZone: d.timeZone,
          regOpen: d.regOpen,
          regClose: d.regClose,
          confirmBy: d.confirmBy,
          start: d.start,
          teams: Number(d.teams),
          minTeams: Number(d.minTeams),
          minBalance: Number(d.minBalance),
          rules: { target: Number(d.target), turnSeconds: Number(d.turnSeconds), flyingCounter: d.flyingCounter === "on" },
          reconnectSeconds: Number(d.reconnectSeconds),
          forfeitSeconds: Number(d.forfeitSeconds),
          insufficient: d.insufficient,
          postponeMinutes: Number(d.postponeMinutes),
          reminderHours: Number(d.reminderHours),
          prizes: { winner: Number(d.prizeWinner || 0), finalist: Number(d.prizeFinalist || 0) },
          entryFee: Number(d.entryFee || 0),
          houseCut: Number(d.houseCut || 15),
          rewards: { winner: f2.getAll("rw-winner"), finalist: f2.getAll("rw-finalist"), participant: f2.getAll("rw-participant") },
          publish: d.publish === "1",
        };
        // (champ « tid » : un champ nommé « id » masquerait l'identifiant du formulaire)
        if (await adminRequest(d.tid ? { type: "tourUpdate", id: d.tid, data } : { type: "tourCreate", data }))
          toast(data.publish ? "Tournoi publié" : "Brouillon enregistré");
        return;
      }
      case "tour-postpone-form":
        if (await adminRequest({ type: "tourPostpone", id: d.tid, start: d.start }))
          toast("Tournoi reporté, inscrits prévenus");
        return;
      case "tour-cancel-form":
        if (await adminRequest({ type: "tourCancel", id: d.tid, reason: d.reason }))
          toast("Tournoi annulé, inscrits prévenus");
        return;
      case "client-credit-form":
        if (await adminRequest({ type: "playerCredit", id: d.cid, amount: Number(d.amount), reason: d.reason }))
          toast("Solde mis à jour");
        return;
      case "client-edit-form":
        if (await adminRequest({ type: "playerUpdate", id: d.cid, name: d.name, avatar: d.avatar, ...(d.email !== undefined ? { email: d.email, verified: d.verified === "on" } : {}), ...(d.password ? { password: d.password } : {}) }))
          toast("Fiche enregistrée");
        return;
      case "broadcast-form":
        if (await adminRequest({ type: "broadcast", title: d.title, body: d.body, audience: d.audience }))
          toast("Notification envoyée");
        return;
      case "bonus-form":
        if (await adminRequest({ type: "loginBonus", amount: Number(d.amount) }))
          toast("Montant du bonus de connexion enregistré");
        return;
      case "admin-form":
        adminToken = d.key;
        f.reset();
        if (await adminRequest()) {
          f.hidden = true;
          try {
            localStorage.setItem("adminKey", adminToken); // reste connecté sur cet appareil
          } catch {}
        }
        return;
    }
  } catch (err) {
    toast(err.message);
  }
}

// Page /admin : formulaire de clé puis tableau de bord (clé mémorisée sur l'appareil).
export function initAdmin() {
  document.title = "Administration — Belote Prestige";
  $("#app").innerHTML = `<main class="admin-page"><header class="admin-top"><img src="/decor/logo.webp" alt=""><div><h1>Back office</h1><small>Belote Prestige · administration</small></div><button type="button" class="chip-btn ghost admin-logout" data-action="adminLogout">Se déconnecter</button></header><form id="admin-form" class="form inline admin-login"><p class="muted">Accès réservé (clé BELOTE_ADMIN_KEY du serveur).</p><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="pill small">Ouvrir</button></form><div id="admin-result"></div></main>`;
  let saved = null;
  try {
    saved = localStorage.getItem("adminKey");
  } catch {}
  if (saved) {
    adminToken = saved;
    $("#admin-form").hidden = true;
    adminRequest().then((ok) => {
      if (ok) return;
      try {
        localStorage.removeItem("adminKey"); // clé changée sur le serveur : on la redemande
      } catch {}
      $("#admin-form").hidden = false;
    });
  }
}
