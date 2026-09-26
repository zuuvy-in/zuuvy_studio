# Zuuvy Sites

An AI-first website platform — landing pages, portfolios and stores — built by
describing what you want. Every change is a version you can preview, compare,
publish and roll back. Stores sell from a connected Zuuvy catalogue: orders go
into Zuuvy, and their progress comes back.

Read `docs/ARCHITECTURE.md` for how it fits together and
`docs/ZUUVY_CONTRACT.md` for the Zuuvy integration.

## Run it

Needs Node 22.12+ and PostgreSQL 16 binaries (`initdb`, `pg_ctl`).

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY to enable AI edits
npm run db:start              # local Postgres in .data/pg on :54329
npm run db:migrate
npm run db:seed               # demo@zuuvy.site / demo12345, site at demo.localhost:3001
npm run dev                   # studio :3000 · sites :3001 · worker · mock Zuuvy :4010
```

Then:

1. Sign in at http://localhost:3000.
2. **Integrations → Zuuvy**: organisation `demo`, channel key `zk_test_demo`.
   The catalogue imports and the webhook registers itself.
3. **Sites → Versions**: describe a change; open the version to preview it,
   compare it with what's live, and publish.
4. Open http://demo.localhost:3001, order something (cash on delivery).
5. Play the business at http://127.0.0.1:4010 — accept, pack, deliver — and
   watch the order page and the studio follow.

## Commands

```bash
npm test                 # unit + database tests (needs db:start)
npm run typecheck
npm run build
npm run db:reset         # drop, migrate and seed again
npm run worker           # the outbox worker on its own
npm run mock:zuuvy       # the mock Zuuvy on its own
```
