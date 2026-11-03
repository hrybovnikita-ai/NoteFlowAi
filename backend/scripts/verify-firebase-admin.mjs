import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!credentialsPath) {
  console.error("FAIL: GOOGLE_APPLICATION_CREDENTIALS is not set in backend/.env");
  process.exit(1);
}

const resolved = path.resolve(credentialsPath);
if (!fs.existsSync(resolved)) {
  console.error(`FAIL: Credentials file not found at ${resolved}`);
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(resolved, "utf8"));
} catch {
  console.error("FAIL: Credentials file is not valid JSON.");
  process.exit(1);
}

if (serviceAccount.type !== "service_account" || !serviceAccount.private_key) {
  console.error("FAIL: File is not a Firebase service account key.");
  process.exit(1);
}

if (serviceAccount.project_id !== projectId) {
  console.error(`FAIL: Service account project_id (${serviceAccount.project_id}) does not match FIREBASE_PROJECT_ID (${projectId}).`);
  process.exit(1);
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = resolved;
const { getFirebaseAdminApp, createFirebaseTokenVerifier } = require("../src/services/firebaseAdmin");

try {
  const app = getFirebaseAdminApp();
  console.log(`OK: Firebase Admin initialized for project ${app.options.projectId}`);
  await createFirebaseTokenVerifier()("not-a-real-token").catch(error => {
    if (String(error.message).includes("Decoding Firebase ID token failed")) {
      console.log("OK: Token verifier reachable (invalid test token rejected as expected).");
      return;
    }
    throw error;
  });
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
}
