require("dotenv").config();

const { createPostgresDatabase } = require("./postgres");

createPostgresDatabase()
  .then(db => db.close())
  .catch(error => {
    console.error("PostgreSQL migrations failed with error code:", error.code || "MIGRATION_FAILED");
    process.exitCode = 1;
  });
