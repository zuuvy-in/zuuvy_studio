-- Email verification: an account proves it owns its address before anything
-- it builds goes live. Accounts that existed before this are taken as verified
-- — they have been receiving order alerts at that address all along.
alter table users add column email_verified_at timestamptz;
update users set email_verified_at = created_at;

create table email_verifications (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  -- the address the link was sent to; an address changed since is not verified by an old link
  email       citext not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index on email_verifications (user_id);

grant select, insert, delete on email_verifications to zsite_app;
