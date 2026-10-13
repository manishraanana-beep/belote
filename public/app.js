const $ = (s) => document.querySelector(s),
  e = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const suits = { S: "♠", H: "♥", D: "♦", C: "♣" },
  names = { S: "Pique", H: "Cœur", D: "Carreau", C: "Trèfle" };
let inviteRequest = null,
  lastRenderedDeal = null,
  distributing = false;
let state,
  ws,
  sound = localStorage.getItem("beloteSound") === "true",
  lastMultiplier = 1,
  tab = "tables",
  invite = null,
  retry = 0;
try {
  invite = JSON.parse(decodeURIComponent(location.hash.slice(1)));
} catch {}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 4500);
}
function cmd(type, data = {}) {
  if (ws?.readyState !== 1) {
    toast("Connexion en cours…");
    return;
  }
  ws.send(JSON.stringify({ id: crypto.randomUUID(), type, data }));
}
function chirp() {
  if (!sound) return;
  try {
    const ctx = new AudioContext(),
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.setValueAtTime(520, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(780, ctx.currentTime + 0.2);
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    o.onended = () => ctx.close();
  } catch {}
}
const btn = (text, action, cls = "", data = "", disabled = false) =>
  `<button class="${cls}" data-action="${action}" ${data} ${disabled ? "disabled" : ""}>${text}</button>`;
function ruleText(r) {
  return `Objectif ${r.target} • ${r.scoring === "added" ? "Points + contrat" : "Contrat seul"} • Belote ${r.beloteRetained ? "conservée" : "perdue si chute"}, ${r.beloteCountsContract ? "compte" : "ne compte pas"} pour le contrat • Capot ${r.capotValue} • Contre ${r.flyingCounter ? "à la volée" : "à son tour"} • Surcontre ${r.counterWindowSeconds}s • Tour ${r.turnSeconds}s • Absence ${r.reconnectSeconds}s • Tous passent : ${r.allPass === "rotate" ? "donneur suivant" : "même donneur"}`;
}
function card(c, { disabled = false, play = false } = {}) {
  const s = c.slice(-1),
    r = c.slice(0, -1),
    label = { J: "V", Q: "D", K: "R" }[r] ?? r;
  return `<button class="card ${["H", "D"].includes(s) ? "red" : ""} ${play ? "playable" : ""}" ${disabled ? "disabled" : ""} ${play ? `data-action="play" data-card="${c}"` : ""} aria-label="${label} de ${names[s]}"><span class="corner">${label}<small>${suits[s]}</small></span><span class="pip">${suits[s]}</span><span class="corner bottom">${label}<small>${suits[s]}</small></span></button>`;
}
function header() {
  const p = state.player;
  return `<header><a class="brand" href="/" aria-label="Maison Belote"><span class="brand-mark">♠</span><span>MAISON <b>BELOTE</b><small>LE PLAISIR DU BEAU JEU</small></span></a><nav>${btn("Les tables", "lobby", "nav-button")}${btn("Mes statistiques", "stats", "nav-button")}${btn(sound ? "♪ Sons activés" : "♪ Sons coupés", "sound", "nav-button")}</nav>${btn(`<span class="avatar">${e(p.avatar)}</span><span>${e(p.name)}<small>MON ESPACE JOUEUR</small></span>`, "profile", "profile-button")}</header>`;
}
function footer() {
  return `<footer><span>♠ &nbsp; Maison Belote · Contrée française</span><span>4 joueurs · 2 équipes · 32 cartes &nbsp; ${btn("Règles", "rulesInfo", "text-button")} ${btn("Administration", "admin", "text-button")}</span></footer>`;
}
function lobby() {
  return `<main class="lobby"><section class="hero"><div class="eyebrow">LE RENDEZ-VOUS DES AMATEURS DE CARTES</div><h1>Une table.<br>Quatre joueurs.<br><em>Le goût du jeu.</em></h1><p>Retrouvez l’esprit de la contrée. Une belle main,<br>un partenaire de confiance, et tout reste à jouer.</p><div class="hero-actions">${btn("♠ &nbsp; Jouer maintenant", "quick", "gold")}${btn("Créer une table VIP ↗", "create", "outline")}</div><div class="hero-meta"><span class="live-dot"></span> Multijoueur en direct <span>•</span> Contre à la volée</div></section><div class="hero-art" aria-hidden="true"><div class="art-ring"></div><div class="art-card left">${card("AS")}</div><div class="art-card right">${card("JH")}</div><span class="art-seal">MAISON<br>♣<br>BELOTE</span><span class="art-label">L’ART DE LA CONTRÉE</span></div><section class="table-section"><div class="section-heading"><div><div class="eyebrow">PRENEZ PLACE</div><h2>Les tables du salon</h2></div><span class="count">${state.tables.length} table${state.tables.length > 1 ? "s" : ""} publique${state.tables.length > 1 ? "s" : ""}</span></div><div class="tabs">${btn("Tables publiques", "tabTables", tab === "tables" ? "selected" : "")}${btn("Invitation VIP", "tabInvite", tab === "invite" ? "selected" : "")}${btn("Entraînement", "practice", "")}</div>${tab === "invite" ? `<div class="invite-panel"><h3>Votre place vous attend</h3><p>Ouvrez un lien d’invitation ou saisissez l’identifiant de la table et son code privé.</p><form id="invite-form"><label>Identifiant de table<input name="tableId" value="${e(invite?.tableId)}" required></label><label>Code d’invitation<input name="invite" value="${e(invite?.invite)}" required></label><label>Mot de passe éventuel<input name="password" type="password" maxlength="128"></label><button class="gold">Demander une place</button></form></div>` : `<div class="table-grid">${state.tables.map((t) => `<article class="table-tile"><div class="tile-top"><span class="badge">PUBLIC</span><span class="table-status"><i class="live-dot"></i> ${e(t.status)}</span></div><span class="tile-suit">${suits.S}</span><h3>${e(t.name)}</h3><p>Contrée à ${t.rules.target} points</p><div class="seat-dots">${[0, 1, 2, 3].map((_, i) => `<span class="${i < 4 - t.available ? "occupied" : ""}">${i < 4 - t.available ? "♟" : "+"}</span>`).join("")}<small>${t.available} place${t.available > 1 ? "s" : ""} libre${t.available > 1 ? "s" : ""}</small></div><div class="tile-bottom">${btn("Voir les règles", "tableRules", "text-button", `data-table="${t.id}"`)}${btn("Rejoindre ↗", "join", "join-button", `data-table="${t.id}"`, !t.available || t.status === "Partie en cours")}</div></article>`).join("")}<article class="table-tile private-tile"><span class="badge vip">SALON PRIVÉ</span><span class="tile-suit">♛</span><h3>Entre vous, simplement.</h3><p>Invitez vos amis et faites de<br>la contrée votre rendez-vous.</p>${btn("Créer une table VIP ↗", "create", "outline")}</article></div>`}${state.requests.length ? `<div class="notice">Demande envoyée à ${state.requests.map((r) => e(r.name)).join(", ")}. Le créateur doit vous accepter.</div>` : ""}<div class="training"><span class="training-icon">♣</span><div><h3>Affûtez votre jeu.</h3><p>Une partie contre trois robots, à votre rythme.</p></div>${btn("S’entraîner →", "practice", "outline")}</div></section></main>`;
}
function seatBox(s, i, mySeat, g) {
  const pos = (i - mySeat + 4) % 4,
    active = g && g.turn === i && ["bidding", "playing"].includes(g.phase);
  return `<div class="player-seat seat-${pos} ${active ? "active" : ""}"><span class="avatar">${e(s?.avatar ?? "+")}</span><strong>${e(s?.name ?? "Place libre")}${i === mySeat ? " · Vous" : ""}</strong><small>Équipe ${i % 2 === mySeat % 2 ? "Nous" : "Eux"} ${s ? (s.bot ? "· Robot" : s.connected ? "· Connecté" : "· Reconnexion…") : ""}</small>${g && pos !== 0 ? `<div class="backs">${Array.from({ length: g.handCounts[i] }, () => "<i></i>").join("")}</div>` : ""}</div>`;
}
function tableView() {
  const t = state.table,
    g = t.game,
    me = t.seats.findIndex((s) => s?.id === state.player.id),
    owner = t.owner === state.player.id;
  return `<main class="game-page"><div class="table-title"><div><span class="badge ${t.vip ? "vip" : ""}">${t.vip ? "VIP · PRIVÉ" : "PUBLIC"}</span><h2>${e(t.name)}</h2></div><div>${btn("Règles de la table", "rulesInfo", "outline")}${btn("Signaler", "report", "text-button")}${btn("Quitter", "leave", "text-button", "", !!g && g.phase !== "finished")}</div></div><div class="game-layout"><section class="play-area"><div class="scoreboard"><div><small>NOUS</small><strong>${g?.scores[me % 2] ?? 0}</strong></div><div class="score-center">${g?.contract ? `${g.contract.amount === 250 ? "CAPOT" : g.contract.amount} ${suits[g.contract.suit]}` : "CONTRÉE"}<small>${g ? `Donne ${g.deal} · ${g.phase === "bidding" ? "Enchères" : g.phase === "counter" ? "Surcontre ouverte" : g.phase === "playing" ? "Jeu en cours" : g.phase === "summary" ? "Fin de donne" : "Partie terminée"}` : `Objectif ${t.rules.target}`}</small>${g?.multiplier > 1 ? `<span class="counter-banner">${g.multiplier === 4 ? "SURCONTRÉ !" : "CONTRÉ !"}</span>` : ""}</div><div><small>EUX</small><strong>${g?.scores[1 - (me % 2)] ?? 0}</strong></div></div><div class="felt"><div class="felt-logo">♠<span>MAISON BELOTE</span></div>${t.seats.map((s, i) => seatBox(s, i, me, g)).join("")}<div class="center-play">${
    g
      ? centerGame(g, t, me)
      : `<div class="waiting"><h3>La table est à vous.</h3><p>Choisissez votre équipe, invitez vos amis<br>ou complétez les places avec des robots.</p><div class="waiting-actions">${t.seats.map((s, i) => (!s ? `${btn(`Place ${i + 1} · Équipe ${(i % 2) + 1}`, "seat", "outline", `data-seat="${i}"`)} ${owner ? btn("+ Robot", "bot", "text-button", `data-seat="${i}"`) : ""}` : owner && i !== me ? btn(`Retirer ${e(s.name)}`, "kick", "text-button", `data-seat="${i}"`) : "")).join("")}</div>${
          owner
            ? btn(
                "Commencer la partie",
                "start",
                "gold",
                "",
                t.seats.some((s) => !s),
              )
            : ""
        }</div>`
  }</div></div>${
    g
      ? `<div class="hand-label">VOTRE MAIN <span>${g.phase === "playing" ? (g.turn === me ? "À vous de jouer · cartes autorisées en lumière" : `Au tour de ${e(t.seats[g.turn]?.name)}`) : e(g.lastEvent)}</span></div><div class="hand ${distributing ? "distributing" : ""}">${[
          ...g.hand,
        ]
          .sort((a, b) => a.slice(-1).localeCompare(b.slice(-1)))
          .map((c) =>
            card(c, {
              disabled: !g.legal.includes(c),
              play: g.legal.includes(c),
            }),
          )
          .join(
            "",
          )}</div><div class="action-bar">${gameActions(g, me, t)}</div>`
      : `<div class="waiting-bottom"><p>${e(ruleText(t.rules))}</p>${owner ? btn("Personnaliser les règles", "editRules", "outline") + btn("Organiser les équipes", "teams", "outline") : ""}</div>`
  }</section><aside class="table-sidebar">${t.vip && owner ? `<section class="side-panel"><h3>♛ Invitations privées</h3><p>Seules les personnes invitées peuvent demander une place.</p>${btn("Copier le lien d’invitation", "copyInvite", "outline")}<details><summary>Code privé</summary><code>${e(t.invite)}</code><small>Table : ${e(t.id)}</small></details>${t.pending.map((p) => `<div class="request"><strong>${e(p.name)}</strong>${btn("Accepter", "admit", "gold", `data-player="${p.id}"`)}${btn("Refuser", "reject", "text-button", `data-player="${p.id}"`)}</div>`).join("")}</section>` : ""}<section class="side-panel chat-panel"><h3>Le coin de la table <span>●</span></h3><div class="chat-messages">${t.chat.length ? t.chat.map((m) => `<p><strong>${e(m.name)}</strong><span>${e(m.text)}</span></p>`).join("") : '<p class="muted">Un bonjour, un beau pli…<br>Le jeu se partage aussi ici.</p>'}</div><div class="reactions">${["👏", "Bien joué !", "🍀"].map((text) => btn(e(text), "reaction", "", `data-text="${e(text)}"`)).join("")}</div><form id="chat-form"><input name="text" placeholder="Votre message…" maxlength="280" aria-label="Message de table" required><button aria-label="Envoyer">↗</button></form></section><section class="side-panel"><h3>Les dernières donnes</h3>${
    g?.history.length
      ? g.history
          .slice(-5)
          .reverse()
          .map(
            (h) =>
              `<div class="history-row"><span>Donne ${h.deal}<small>${h.made ? "Réussi" : "Chuté"} · ${h.contract.amount} ${suits[h.contract.suit]}</small></span><strong>${h.score[me % 2]} / ${h.score[1 - (me % 2)]}</strong></div>`,
          )
          .join("")
      : '<p class="muted">Les scores apparaîtront ici.</p>'
  }${g ? btn("Historique des plis", "tricks", "text-button") : ""}</section></aside></div></main>`;
}
function centerGame(g, t, me) {
  if (["summary", "finished"].includes(g.phase)) {
    const h = g.history.at(-1);
    return `<div class="summary"><div class="eyebrow">${g.phase === "finished" ? "PARTIE TERMINÉE" : "DONNE TERMINÉE"}</div><h3>${e(g.lastEvent)}</h3><p>Points : ${h.points[me % 2]} / ${h.points[1 - (me % 2)]}<br>Belote : ${h.belote[me % 2]} / ${h.belote[1 - (me % 2)]}</p><strong>+${h.score[me % 2]} / +${h.score[1 - (me % 2)]}</strong>${g.phase === "summary" ? btn("Donne suivante →", "next", "gold") : t.owner === state.player.id ? btn("Revanche →", "rematch", "gold") : "<p>Le créateur peut lancer une revanche.</p>"}</div>`;
  }
  if (g.phase === "playing") {
    const trick = g.trick.length ? g.trick : (g.tricks.at(-1)?.cards ?? []);
    return `<div class="trick ${!g.trick.length && g.tricks.length ? "last-trick" : ""}">${trick.map((p) => `<div class="trick-card trick-${(p.seat - me + 4) % 4}">${card(p.card)}<small>${e(t.seats[p.seat].name)}</small></div>`).join("")}</div>`;
  }
  return `<div class="auction-center"><span class="auction-icon">${g.contract ? suits[g.contract.suit] : "♠"}</span><h3>${g.phase === "counter" ? "CONTRÉ !" : g.contract ? `${g.contract.amount === 250 ? "Capot" : g.contract.amount} ${names[g.contract.suit]}` : "Les enchères sont ouvertes"}</h3><p>${g.contract ? `Proposé par ${e(t.seats[g.contract.seat].name)}` : "À vous de trouver votre contrat."}</p>${g.phase === "counter" ? "<p>L’équipe preneuse peut surcontrer.</p>" : `<small>${g.passes} passe${g.passes > 1 ? "s" : ""} consécutive${g.passes > 1 ? "s" : ""}</small>`}</div>`;
}
function gameActions(g, me, t) {
  const counter =
    g.phase === "bidding" &&
    g.contract &&
    me % 2 !== g.contract.seat % 2 &&
    (g.rules.flyingCounter || g.turn === me);
  const sur = g.phase === "counter" && me % 2 === g.contract.seat % 2;
  return `${
    g.phase === "bidding" && g.turn === me
      ? `<form id="bid-form"><select name="amount" aria-label="Valeur du contrat">${[
          80, 90, 100, 110, 120, 130, 140, 150, 160, 250,
        ]
          .filter((n) => !g.contract || n > g.contract.amount)
          .map(
            (n) => `<option value="${n}">${n === 250 ? "Capot" : n}</option>`,
          )
          .join(
            "",
          )}</select><select name="suit" aria-label="Atout">${Object.entries(
          names,
        )
          .map(([s, n]) => `<option value="${s}">${suits[s]} ${n}</option>`)
          .join(
            "",
          )}</select><button class="gold" ${g.contract?.amount === 250 ? "disabled" : ""}>Enchérir</button></form>${btn("Passer", "pass", "outline")}`
      : ""
  }${counter ? btn("CONTRER !", "counter", "danger") : ""}${sur ? btn("SURCONTRER !", "surcounter", "danger") : ""}<span class="timer" data-deadline="${g.counterDeadline ?? t.deadline ?? 0}"></span>`;
}
function render() {
  if (!state) return;
  const dealKey = state.table?.game
    ? state.table.gameId + ":" + state.table.game.deal
    : null;
  distributing = dealKey !== lastRenderedDeal;
  lastRenderedDeal = dealKey;
  const focus = document.activeElement,
    form = focus?.closest("form")?.id,
    name = focus?.name;
  const fields = {};
  document
    .querySelectorAll("form[id] input,form[id] select")
    .forEach(
      (el) => (fields[el.closest("form").id + ":" + el.name] = el.value),
    );
  const chat = $(".chat-messages"),
    scrolled =
      chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight > 40;
  $("#app").innerHTML =
    header() + (state.table ? tableView() : lobby()) + footer();
  document.querySelectorAll("form[id] input,form[id] select").forEach((el) => {
    const v = fields[el.closest("form").id + ":" + el.name];
    if (
      v !== undefined &&
      (!el.options || [...el.options].some((o) => o.value === v))
    )
      el.value = v;
  });
  if (form && name)
    document.querySelector(`#${form} [name="${name}"]`)?.focus();
  if (!scrolled && $(".chat-messages"))
    $(".chat-messages").scrollTop = $(".chat-messages").scrollHeight;
  clock();
}
function modal(content) {
  $("#modal").innerHTML = `${btn("×", "close", "close-button")} ${content}`;
  $("#modal").showModal();
}
function ruleForm(r, creating = false) {
  return `<form id="${creating ? "create-form" : "rules-form"}">${creating ? '<label>Nom de la table<input name="name" placeholder="Le salon des amis" required maxlength="40"></label><label>Type<select name="vip"><option value="true">VIP privée sur invitation</option><option value="false">Publique</option></select></label><label>Mot de passe facultatif<input name="password" type="password" maxlength="128" autocomplete="new-password"></label>' : ""}<div class="form-grid">${[
    ["target", "Score cible", 100, 10000],
    ["turnSeconds", "Durée du tour (s)", 5, 120],
    ["counterWindowSeconds", "Délai de surcontre (s)", 2, 30],
    ["reconnectSeconds", "Délai de reconnexion (s)", 10, 600],
    ["capotValue", "Valeur du capot", 160, 500],
  ]
    .map(
      ([k, label, min, max]) =>
        `<label>${label}<input name="${k}" type="number" value="${r[k]}" min="${min}" max="${max}" required></label>`,
    )
    .join(
      "",
    )}<label>Convention de score<select name="scoring"><option value="added" ${r.scoring === "added" ? "selected" : ""}>Points réalisés + contrat</option><option value="contract" ${r.scoring === "contract" ? "selected" : ""}>Contrat seul (preneur)</option></select></label><label>Tous passent<select name="allPass"><option value="redeal" ${r.allPass === "redeal" ? "selected" : ""}>Redistribution, même donneur</option><option value="rotate" ${r.allPass === "rotate" ? "selected" : ""}>Donneur suivant</option></select></label></div>${[
    ["flyingCounter", "Contre à la volée (les deux adversaires)"],
    ["beloteRetained", "Conserver la belote en cas de chute"],
    ["beloteCountsContract", "La belote compte pour réussir le contrat"],
  ]
    .map(
      ([k, label]) =>
        `<label class="checkbox"><input name="${k}" type="checkbox" ${r[k] ? "checked" : ""}>${label}</label>`,
    )
    .join(
      "",
    )}<p class="muted">Équipes : places 1 + 3 contre 2 + 4. Les règles sont figées pendant la partie. VIP désigne une table privée, sans abonnement.</p><button class="gold">${creating ? "Créer la table" : "Enregistrer"}</button></form>`;
}
const defaults = {
  target: 1000,
  turnSeconds: 30,
  counterWindowSeconds: 8,
  reconnectSeconds: 90,
  capotValue: 250,
  scoring: "added",
  allPass: "redeal",
  flyingCounter: true,
  beloteRetained: true,
  beloteCountsContract: true,
};
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action,
    t = state?.table,
    g = t?.game;
  switch (a) {
    case "close":
      $("#modal").close();
      break;
    case "sound":
      sound = !sound;
      localStorage.setItem("beloteSound", sound);
      render();
      chirp();
      break;
    case "lobby":
      if (t)
        toast(
          "Votre table est ouverte. Terminez la partie ou utilisez Quitter.",
        );
      else {
        tab = "tables";
        render();
      }
      break;
    case "tabTables":
      tab = "tables";
      render();
      break;
    case "tabInvite":
      tab = "invite";
      render();
      break;
    case "create":
      modal("<h2>Votre salon, vos règles.</h2>" + ruleForm(defaults, true));
      break;
    case "quick": {
      const target = state.tables.find(
        (t) => t.available && t.status !== "Partie en cours",
      );
      if (target)
        modal(
          `<h2>${e(target.name)}</h2><p>${e(ruleText(target.rules))}</p>${btn("Accepter les règles et rejoindre", "confirmJoin", "gold", `data-table="${target.id}"`)}`,
        );
      else cmd("create", { name: "Nouvelle table publique", vip: false });
      break;
    }
    case "join":
    case "tableRules": {
      const target = state.tables.find((t) => t.id === el.dataset.table);
      modal(
        `<h2>${e(target.name)}</h2><p>${e(ruleText(target.rules))}</p><p>À l’expiration du tour : passe aux enchères, première carte autorisée au jeu. Après le délai d’absence : un robot joue jusqu’au retour. La place est conservée pendant la partie.</p>${a === "join" ? btn("Accepter les règles et rejoindre", "confirmJoin", "gold", `data-table="${target.id}"`) : ""}`,
      );
      break;
    }
    case "confirmVip":
      cmd("join", inviteRequest);
      $("#modal").close();
      break;
    case "confirmJoin":
      cmd("join", { tableId: el.dataset.table });
      $("#modal").close();
      break;
    case "rulesInfo":
      modal(
        `<h2>Les règles de la contrée</h2><p>${e(ruleText(t?.rules ?? defaults))}</p><p>Fournissez la couleur demandée. À l’atout, montez si possible. Sans la couleur demandée, coupez et surcoupez si possible, sauf si votre partenaire est maître. Si vous devez couper sans pouvoir surcouper, sous-coupez.</p><p>Atout : V, 9, A, 10, R, D, 8, 7. Hors atout : A, 10, R, D, V, 9, 8, 7. Dernier pli : 10 points. Belote et rebelote sont annoncées automatiquement en jouant R et D d’atout.</p><p>Réussite : le preneur marque son contrat et ses points (ou son seul contrat, selon la variante), multipliés par 2 ou 4. Chute : les adversaires marquent 162 + contrat (ou contrat seul), multipliés. La belote est ajoutée sans multiplication. Capot : les huit plis sont nécessaires.</p><p>Tour expiré : passe ou première carte autorisée. Place conservée pendant la partie ; après ${t?.rules.reconnectSeconds ?? 90}s d’absence un robot joue jusqu’au retour. Avant lancement, la place est libérée après ce délai.</p>`,
      );
      break;
    case "practice":
      modal(
        `<h2>Entraînement contre les robots</h2><p>${e(ruleText(defaults))}</p>${btn("Accepter les règles et jouer", "confirmPractice", "gold")}`,
      );
      break;
    case "confirmPractice":
      cmd("practice");
      $("#modal").close();
      break;
    case "teams":
      modal(
        `<h2>Choisir les équipes</h2><p>Places 1 + 3 contre 2 + 4. Déplacer un joueur vers une place occupée échange les deux places.</p>${t.seats.map((s, i) => `<label>Place ${i + 1} : ${e(s?.name ?? "Libre")}<select data-move="${i}">${[0, 1, 2, 3].map((j) => `<option value="${j}" ${j === i ? "selected" : ""}>Place ${j + 1} · Équipe ${(j % 2) + 1}</option>`).join("")}</select></label>`).join("")}`,
      );
      break;
    case "editRules":
      modal("<h2>Règles de la table</h2>" + ruleForm(t.rules));
      break;
    case "profile":
      modal(
        `<h2>Votre espace joueur</h2><form id="profile-form"><label>Pseudo<input name="name" maxlength="24" required value="${e(state.player.name)}"></label><label>Avatar<select name="avatar">${["♠", "♥", "♦", "♣", "👑", "🌟"].map((s) => `<option ${s === state.player.avatar ? "selected" : ""}>${s}</option>`).join("")}</select></label><button class="gold">Enregistrer</button></form>${btn("Mes statistiques", "stats", "outline")}${btn(sound ? "Couper les sons" : "Activer les sons", "sound", "outline")}<p class="muted">Votre profil invité est conservé dans ce navigateur. Gardez ses cookies pour retrouver votre place.</p>`,
      );
      break;
    case "stats":
      modal(
        `<h2>Votre parcours</h2><div class="stats"><strong>${state.player.stats.games}<small>PARTIES</small></strong><strong>${state.player.stats.wins}<small>VICTOIRES</small></strong></div>${state.player.history.map((h) => `<div class="history-row"><span>${e(h.table)}<small>${new Date(h.date).toLocaleDateString("fr-FR")}</small></span><strong>${h.won ? "Victoire" : "Défaite"} · ${h.scores.join(" / ")}</strong></div>`).join("") || "<p>Votre première partie vous attend.</p>"}`,
      );
      break;
    case "copyInvite": {
      const link =
        location.origin +
        "/#" +
        encodeURIComponent(JSON.stringify({ tableId: t.id, invite: t.invite }));
      try {
        await navigator.clipboard.writeText(link);
        toast("Lien privé copié");
      } catch {
        modal(
          `<h2>Lien privé</h2><input readonly value="${e(link)}" aria-label="Lien privé à copier">`,
        );
      }
      break;
    }
    case "pass":
    case "counter":
    case "surcounter":
      cmd("action", { version: g.version, action: { type: a } });
      break;
    case "play":
      cmd("action", {
        version: g.version,
        action: { type: "play", card: el.dataset.card },
      });
      break;
    case "bot":
    case "kick":
    case "seat":
      cmd(a, { seat: Number(el.dataset.seat) });
      break;
    case "admit":
    case "reject":
      cmd(a, { playerId: el.dataset.player });
      break;
    case "start":
    case "next":
    case "rematch":
    case "leave":
      cmd(a);
      break;
    case "reaction":
      cmd("chat", { text: el.dataset.text });
      break;
    case "report":
      modal(
        '<h2>Signaler un problème</h2><form id="report-form"><label>Que s’est-il passé ?<textarea name="reason" maxlength="500" required></textarea></label><button class="gold">Envoyer le signalement</button></form>',
      );
      break;
    case "tricks":
      modal(
        `<h2>Historique des plis</h2>${[...(g.history ?? []).flatMap((h) => h.tricks.map((p, i) => ({ ...p, deal: h.deal, index: i + 1 }))), ...g.tricks.map((p, i) => ({ ...p, deal: g.deal, index: i + 1 }))].map((p) => `<div class="history-row"><span>Donne ${p.deal} · Pli ${p.index}<small>${e(t.seats[p.winner]?.name)} · ${p.points} points</small></span><strong>${p.cards.map((c) => e(c.card.slice(0, -1)) + suits[c.card.slice(-1)]).join(" ")}</strong></div>`).join("") || "<p>Aucun pli terminé.</p>"}`,
      );
      break;
    case "admin":
      modal(
        '<h2>Administration</h2><p>Accès réservé. La clé doit être configurée sur le serveur avec BELOTE_ADMIN_KEY.</p><form id="admin-form"><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="gold">Ouvrir</button></form><div id="admin-result"></div>',
      );
      break;
    case "suspendPlayer":
      await adminRequest({
        type: "suspend",
        id: el.dataset.id,
        enabled: el.dataset.enabled === "true",
      });
      break;
    case "deleteTable":
      await adminRequest({ type: "deleteTable", id: el.dataset.id });
      break;
    case "resolveReport":
      await adminRequest({ type: "resolve", id: el.dataset.id });
      break;
    case "maintenance":
      await adminRequest({
        type: "maintenance",
        enabled: el.dataset.enabled === "true",
      });
      break;
  }
});
document.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-move]")) {
    cmd("move", {
      from: Number(ev.target.dataset.move),
      to: Number(ev.target.value),
    });
    $("#modal").close();
  }
});
let adminToken = "";
async function adminRequest(data) {
  try {
    const res = await fetch("/api/admin", {
      method: data ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + adminToken,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw Error(await res.text());
    const d = await res.json();
    $("#admin-result").innerHTML =
      `<h3>${d.players.length} joueurs · ${d.tables.length} tables</h3>${btn(d.settings.maintenance ? "Rouvrir les entrées" : "Suspendre les nouvelles entrées", "maintenance", "outline", `data-enabled="${!d.settings.maintenance}"`)}<h3>Joueurs</h3>${d.players.map((p) => `<div class="history-row"><span>${e(p.name)} · ${p.stats.games} parties</span>${btn(p.banned ? "Réactiver" : "Suspendre", "suspendPlayer", "outline", `data-id="${p.id}" data-enabled="${!p.banned}"`)}</div>`).join("")}<h3>Tables</h3>${d.tables.map((t) => `<div class="history-row"><span>${e(t.name)} · ${e(t.status)}</span>${btn("Supprimer", "deleteTable", "outline", `data-id="${t.id}"`, t.status === "Partie en cours")}</div>`).join("")}<h3>Signalements</h3>${d.reports.map((r) => `<div class="history-row"><span>${e(r.reason)}<small>${new Date(r.at).toLocaleString("fr-FR")}</small></span>${r.resolved ? "Traité" : btn("Traiter", "resolveReport", "outline", `data-id="${r.id}"`)}</div>`).join("") || "<p>Aucun signalement.</p>"}`;
  } catch (err) {
    toast(err.message);
  }
}
document.addEventListener("submit", (ev) => {
  const f = ev.target;
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  if (f.id === "bid-form")
    cmd("action", {
      version: state.table.game.version,
      action: { type: "bid", amount: Number(d.amount), suit: d.suit },
    });
  if (f.id === "chat-form") {
    cmd("chat", { text: d.text });
    f.reset();
    return;
  }
  if (["create-form", "rules-form"].includes(f.id)) {
    const r = {};
    for (const k of [
      "target",
      "turnSeconds",
      "counterWindowSeconds",
      "reconnectSeconds",
      "capotValue",
    ])
      r[k] = Number(d[k]);
    for (const k of ["scoring", "allPass"]) r[k] = d[k];
    for (const k of ["flyingCounter", "beloteRetained", "beloteCountsContract"])
      r[k] = d[k] === "on";
    cmd(f.id === "create-form" ? "create" : "rules", {
      ...d,
      vip: d.vip === "true",
      rules: r,
    });
  }
  if (f.id === "profile-form") cmd("profile", d);
  if (f.id === "invite-form") {
    inviteRequest = d;
    cmd("inspectInvite", d);
  }
  if (f.id === "report-form") {
    cmd("report", d);
    toast("Signalement envoyé");
  }
  if (f.id === "admin-form") {
    adminToken = d.key;
    f.reset();
    adminRequest();
    return;
  }
  if ($("#modal").open) $("#modal").close();
});
function clock() {
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const n = Math.max(
      0,
      Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000),
    );
    el.textContent = Number(el.dataset.deadline) ? `◷ ${n}s` : "";
  });
}
setInterval(clock, 500);
async function connect() {
  try {
    const session = await fetch("/api/session", { method: "POST" });
    if (!session.ok) {
      toast("Accès au profil indisponible. Contactez l’administrateur.");
      return;
    }
    ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws.onopen = () => {
      if (retry) toast("Connexion rétablie · partie restaurée");
      retry = 0;
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") {
        const m = msg.table?.game?.multiplier ?? 1;
        if (m > lastMultiplier) chirp();
        lastMultiplier = m;
        state = msg;
        if (invite && !state.table) tab = "invite";
        render();
      }
      if (msg.type === "ack" && msg.invitation) {
        modal(
          `<h2>${e(msg.invitation.name)}</h2><p>${e(ruleText(msg.invitation.rules))}</p><p>Tour expiré : passe ou première carte autorisée. Un robot prend le relais après le délai d’absence, votre place reste réservée.</p>${btn("Accepter les règles et demander une place", "confirmVip", "gold")}`,
        );
      }
      if (msg.type === "error") toast(msg.message);
    };
    ws.onclose = () => {
      toast("Connexion perdue · reconnexion automatique…");
      setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++));
    };
  } catch {
    setTimeout(connect, 3000);
  }
}
connect();
