require("dotenv").config();

const { createApp } = require("./src/app");
const { createDatabase } = require("./src/database/connection");

const port = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || "./data/noteflow.sqlite";
const driver = process.env.STORAGE_DRIVER || 'firestore';
if (!['firestore', 'sqlite'].includes(driver)) throw new Error('STORAGE_DRIVER must be firestore or sqlite');
const db = driver === 'firestore'
  ? require('./src/database/firestore').createFirestoreDatabase(require('firebase-admin/firestore').getFirestore(require('./src/services/firebaseAdmin').getFirebaseAdminApp(), process.env.FIRESTORE_DATABASE_ID || '(default)'))
  : createDatabase(databasePath);
const app = createApp({ db });

const server = app.listen(port, () => {
  console.log(`NoteFlow AI API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
