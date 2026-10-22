// Sauvegarde des données vers un stockage compatible S3 (Cloudflare R2, Backblaze B2, Scaleway…),
// hors de l'hébergeur du jeu. Signature AWS v4 faite à la main : aucune dépendance.
import { createHash, createHmac } from "node:crypto";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

export function createBackup(env = process.env) {
  const cfg = {
    endpoint: env.BELOTE_BACKUP_S3_ENDPOINT?.replace(/\/$/, ""),
    bucket: env.BELOTE_BACKUP_S3_BUCKET,
    accessKeyId: env.BELOTE_BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BELOTE_BACKUP_S3_SECRET_ACCESS_KEY,
    region: env.BELOTE_BACKUP_S3_REGION || "auto",
  };
  const enabled = !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);

  // Envoie un fichier (PUT) ; lève une erreur si le stockage refuse.
  async function upload(key, body, now = new Date()) {
    if (!enabled) throw Error("Sauvegarde externe non configurée");
    const url = new URL(cfg.endpoint);
    const path = `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    const signed = Object.keys(headers).sort();
    const canonical = ["PUT", path, "", ...signed.map((h) => `${h}:${headers[h]}`), "", signed.join(";"), payloadHash].join("\n");
    const scope = `${day}/${cfg.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    const kSigning = ["s3", "aws4_request"].reduce((k, x) => hmac(k, x), hmac(hmac("AWS4" + cfg.secretAccessKey, day), cfg.region));
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    const res = await fetch(url.origin + path, {
      method: "PUT",
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        "Content-Type": "application/json",
        Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
      },
      body,
    });
    if (!res.ok) throw Error(`Stockage : erreur ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { enabled, upload, bucket: cfg.bucket };
}
