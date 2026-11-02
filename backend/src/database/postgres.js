const { Pool } = require("pg");
const { migratePostgres } = require("./postgresMigrations");
const { createPostgresData } = require("./postgresData");

function createPostgresDatabase({
  connectionString = process.env.DATABASE_URL,
  poolOptions = {},
  migrate = migratePostgres,
} = {}) {
  if (!connectionString) throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres.");
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ...poolOptions,
  });
  pool.on("error", error => {
    console.error("PostgreSQL pool error:", error.code || "UNKNOWN");
  });

  return (async () => {
    try {
      await pool.query("SELECT 1");
      await migrate(pool);
      const database = {
        kind: "postgres",
        pool,
        query: (text, values = []) => pool.query(text, values),
        async transaction(operation) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const result = await operation(client);
            await client.query("COMMIT");
            return result;
          } catch (error) {
            try {
              await client.query("ROLLBACK");
            } catch (rollbackError) {
              console.error("PostgreSQL rollback failed:", rollbackError.code || "UNKNOWN");
            }
            throw error;
          } finally {
            client.release();
          }
        },
        close: () => pool.end(),
      };
      Object.assign(database, createPostgresData(database));
      return database;
    } catch (error) {
      await pool.end();
      throw error;
    }
  })();
}

module.exports = { createPostgresDatabase };
