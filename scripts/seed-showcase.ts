/**
 * Seeds the premade sites onto the platform admin's account and offers them
 * as showcases. Safe to run again (each run publishes the current designs).
 *
 *   npm run db:seed:showcase                      # SHOWCASE_EMAIL, else SUPERADMIN_EMAIL, else rishav@zuuvy.in
 *   npm run db:seed:showcase -- bakery clinic     # only these
 *
 * Photos need UNSPLASH_ACCESS_KEY; without it the sites seed with placeholders.
 */
import { closePool, loadRootEnv, seedShowcases, unsplashSearch } from "@zsite/platform";
import { explainDbError } from "./db-hint";

loadRootEnv();
const email = process.env.SHOWCASE_EMAIL || process.env.SUPERADMIN_EMAIL || "rishav@zuuvy.in";
const key = process.env.UNSPLASH_ACCESS_KEY;
if (!key) console.log("showcase: UNSPLASH_ACCESS_KEY is not set — seeding without photos");
try {
  await seedShowcases(email, { search: key ? unsplashSearch(key) : null, only: process.argv.slice(2), log: (l) => console.log(`showcase: ${l}`) }).catch(explainDbError);
} finally {
  await closePool();
}
