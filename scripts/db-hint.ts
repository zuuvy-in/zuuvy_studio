/** Turns "the database is not there" into one line saying how to fix it. */
export function explainDbError(e: unknown): never {
  const err = e as Error & { code?: string; errors?: { code?: string }[] };
  const code = err.code ?? err.errors?.[0]?.code;
  if (code === "ECONNREFUSED") {
    console.error("\nCannot reach Postgres on the port in DATABASE_URL / DATABASE_ADMIN_URL (default 54329).");
    console.error("Start it first:  npm run db:start   (see README for macOS and Docker)\n");
  } else if (code === "3D000") {
    console.error("\nThe database does not exist yet. `npm run db:start` creates it.\n");
  } else if (code === "28000" || code === "28P01") {
    console.error("\nPostgres refused the login. `npm run db:start` creates the zsite_app role; check DATABASE_URL in .env.\n");
  } else {
    console.error(err);
  }
  process.exit(1);
}
