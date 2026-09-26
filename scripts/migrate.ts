/** Apply pending migrations as the admin role. */
import { join } from "node:path";
import { config, loadRootEnv, migrate } from "@zsite/platform";

loadRootEnv();
const applied = await migrate(config.databaseAdminUrl(), join(import.meta.dirname, "../db/migrations"), (s) => console.log(s));
console.log(applied.length ? `${applied.length} migration(s) applied` : "database is up to date");
