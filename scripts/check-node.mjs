// Runs before `npm run dev` (predev): a readable error instead of a crash deep inside a dependency.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`\nZuuvy Sites needs Node 22.12 or newer; this is Node ${process.versions.node}.`);
  console.error("Run `nvm use` (the repo has an .nvmrc) or install Node 22, then `rm -rf node_modules && npm install`.\n");
  process.exit(1);
}
