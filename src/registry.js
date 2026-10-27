// Registre des achats de jetons, rapproché des paiements (Stripe, Apple, Google).
// Un achat = une ligne, identifiée par la plateforme et sa référence de paiement :
//  - jamais crédité deux fois (même notification reçue plusieurs fois, ou réimportée) ;
//  - l'achat et ses jetons sont écrits ensemble (même enregistrement SQLite) ;
//  - remboursement ou opposition bancaire : les jetons sont repris (dans la limite du solde
//    disponible ; le reste dû est noté et signalé dans le back-office).
// Les achats restent désactivés tant que BELOTE_PURCHASES n'est pas « on ».

export function createRegistry({ db, economy, toUnits, packs, now = () => Date.now() }) {
  db.purchases ??= {};
  const keyOf = (provider, ref) => `${provider}:${ref}`;

  function record(p, purchase) {
    if (!p) throw Object.assign(Error("Joueur introuvable"), { status: 400 });
    const pack = packs().find((x) => x.id === purchase.packId);
    if (!pack) throw Object.assign(Error("Pack inconnu"), { status: 400 });
    const key = keyOf(purchase.provider, purchase.transactionId);
    const known = db.purchases[key];
    if (known) return { purchase: known, credited: false };
    const entry = economy.post(p, `purchase:${key}`, "purchase", toUnits(pack.credits), {
      label: `Pack ${pack.credits} crédits`,
      provider: purchase.provider,
      transactionId: purchase.transactionId,
    });
    const row = {
      key,
      provider: purchase.provider,
      ref: String(purchase.transactionId),
      paymentRef: purchase.paymentRef ?? null, // ex. payment_intent Stripe (utile pour les remboursements)
      pid: p.id,
      pack: pack.id,
      credits: pack.credits,
      amountCents: purchase.amountCents ?? pack.priceCents ?? null,
      currency: purchase.currency ?? "eur",
      status: "paid",
      at: now(),
      ledgerId: entry?.id ?? null,
    };
    db.purchases[key] = row;
    return { purchase: row, credited: !!entry };
  }

  // Remboursement / opposition : retrouve l'achat par sa référence ou sa référence de paiement.
  function reverse({ provider, ref, paymentRef, reason = "refund" }) {
    const row = Object.values(db.purchases).find((x) => x.provider === provider && ((ref && x.ref === String(ref)) || (paymentRef && x.paymentRef === paymentRef)));
    if (!row || row.status !== "paid") return null;
    const p = db.players[row.pid];
    const due = toUnits(row.credits);
    const w = p?.wallet ?? { balance: 0, reserved: 0 };
    const take = Math.max(0, Math.min(due, w.balance - w.reserved));
    if (p && take > 0) economy.post(p, `reverse:${row.key}`, reason === "dispute" ? "dispute" : "refund", -take, { label: reason === "dispute" ? "Opposition bancaire" : "Achat remboursé", provider, transactionId: row.ref });
    row.status = reason === "dispute" ? "disputed" : "refunded";
    row.reversedAt = now();
    row.recovered = take / 2;
    row.owed = (due - take) / 2; // jetons déjà dépensés, non repris
    return row;
  }

  const list = (pid) =>
    Object.values(db.purchases)
      .filter((x) => !pid || x.pid === pid)
      .sort((a, b) => b.at - a.at);

  function summary() {
    const rows = Object.values(db.purchases);
    return {
      count: rows.length,
      paid: rows.filter((x) => x.status === "paid").length,
      reversed: rows.filter((x) => x.status !== "paid").length,
      owed: rows.reduce((n, x) => n + (x.owed ?? 0), 0),
      revenueCents: rows.filter((x) => x.status === "paid").reduce((n, x) => n + (x.amountCents ?? 0), 0),
    };
  }
  return { record, reverse, list, summary };
}
