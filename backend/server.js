require("dotenv").config();

const { existsSync } = require("node:fs");
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath && !existsSync(credentialsPath)) {
  console.error(
    "Firebase Admin credentials file is missing. Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON path, then restart the API.",
  );
}

const { createApp } = require("./src/app");
const { createDatabase } = require("./src/database/connection");

const port = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || "./data/noteflow.sqlite";
const driver = process.env.STORAGE_DRIVER || "firestore";

async function start() {
  if (!["firestore", "sqlite", "postgres"].includes(driver)) {
    throw new Error("STORAGE_DRIVER must be firestore, sqlite, or postgres.");
  }
  const db = driver === "firestore"
    ? require("./src/database/firestore").createFirestoreDatabase(require("firebase-admin/firestore").getFirestore(require("./src/services/firebaseAdmin").getFirebaseAdminApp(), process.env.FIRESTORE_DATABASE_ID || "(default)"))
    : driver === "postgres"
      ? await require("./src/database/postgres").createPostgresDatabase()
      : createDatabase(databasePath);
  const app = createApp({ db });
  const server = app.listen(port, () => {
    console.log(`NoteFlow AI API listening on http://localhost:${port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(error => {
  console.error("NoteFlow AI API failed to start with error code:", error.code || "STARTUP_FAILED");
  process.exitCode = 1;
});
