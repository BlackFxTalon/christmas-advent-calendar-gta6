import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const migrationVersion = "001_player_progress.sql";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DATABASE_URL before running migrations.");

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TABLE IF NOT EXISTS bot_schema_migrations (
           version TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
      const existing = await client.query(
        "SELECT version FROM bot_schema_migrations WHERE version = $1",
        [migrationVersion],
      );

      if (existing.rowCount === 0) {
        const sql = await readFile(resolve(here, "migrations", migrationVersion), "utf8");
        await client.query(sql);
        await client.query(
          "INSERT INTO bot_schema_migrations (version) VALUES ($1)",
          [migrationVersion],
        );
        await client.query("COMMIT");
        console.log(`Applied migration ${migrationVersion}.`);
      } else {
        await client.query("COMMIT");
        console.log(`Migration ${migrationVersion} is already applied.`);
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  const code = error?.code ?? error?.name ?? "Error";
  console.error(`PostgreSQL migration failed (${code}). Check DATABASE_URL and database permissions.`);
  process.exitCode = 1;
});
