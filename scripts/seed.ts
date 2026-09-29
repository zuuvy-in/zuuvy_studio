/**
 * A demo business to click around in: an owner account and a store site.
 * Idempotent — re-running leaves an existing demo alone.
 */
import { closePool, createSite, loadRootEnv, signup, siteUrl, withGlobal, withTenant } from "@zsite/platform";
import { explainDbError } from "./db-hint";

loadRootEnv();
const EMAIL = "demo@zuuvy.site";
const PASSWORD = "demo12345";

const existing = await withGlobal((tx) => tx.one("select 1 from users where email = $1", [EMAIL])).catch(explainDbError);
if (existing) {
  console.log(`demo account exists — sign in as ${EMAIL} / ${PASSWORD}`);
} else {
  const who = await signup({ businessName: "Demo Mobiles", name: "Demo Owner", email: EMAIL, password: PASSWORD, emailVerified: true });
  const site = await withTenant(who.tenantId, (tx) =>
    createSite(tx, {
      name: "Demo Mobiles",
      subdomain: "demo",
      templateId: "store-classic",
      templateInput: { businessName: "Demo Mobiles", tagline: "Genuine mobile accessories, delivered across Patna", phone: "9876543210", email: EMAIL },
      userId: who.userId,
    }),
  );
  console.log(`seeded: sign in as ${EMAIL} / ${PASSWORD}`);
  console.log(`live site: ${siteUrl(site.subdomain)}`);
}
console.log("connect Zuuvy (mock): organisation 'demo', channel key 'zk_test_demo'");
await closePool();
