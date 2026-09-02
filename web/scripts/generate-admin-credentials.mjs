import { createHash, randomBytes } from "node:crypto";

const key = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(key).digest("hex");
const secret = randomBytes(32).toString("base64url");

console.log("Operator key (save this; it is not stored by the app):");
console.log(key);
console.log("\nVercel environment variables:");
console.log(`ADMIN_KEY_SHA256=${hash}`);
console.log(`ADMIN_SESSION_SECRET=${secret}`);
