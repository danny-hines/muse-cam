import { createHash, randomBytes } from "node:crypto";

const supplied = process.argv[2];
const token = supplied || randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

if (!supplied) {
  process.stdout.write(`DEVICE_API_TOKEN=${token}\n`);
}
process.stdout.write(`DEVICE_API_TOKEN_SHA256=${hash}\n`);
