-- Plans before builds, and what a store does with products it has run out of.

-- A plan the AI drafts from a short request, before anything is built. It
-- costs tokens like an edit, so it is metered like one.
alter table ai_usage drop constraint if exists ai_usage_outcome_check;
alter table ai_usage add constraint ai_usage_outcome_check
  check (outcome in ('version', 'no_change', 'refused', 'error', 'plan'));

-- Out-of-stock products in a store:
--   show  listed and marked "Out of stock"; cannot be ordered (the default, as before)
--   hide  left out of the storefront until stock returns
--   sell  listed and orderable: the business takes the order and sources it
alter table sites
  add column out_of_stock text not null default 'show' check (out_of_stock in ('show', 'hide', 'sell'));

-- What accepting an order actually took off the shelf, per product id. A store
-- that sells out-of-stock products takes only what is there, so cancelling
-- must put back exactly that, not the ordered quantity.
alter table orders add column stock_taken jsonb;
