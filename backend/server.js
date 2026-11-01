require("dotenv").config();

const { createApp } = require("./src/app");
const { createDatabase } = require("./src/database/connection");

const port = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || "./data/noteflow.sqlite";
const db = createDatabase(databasePath);
const app = createApp({ db });

const server = app.listen(port, () => {
  console.log(`NoteFlow AI API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
