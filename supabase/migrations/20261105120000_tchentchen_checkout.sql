-- Tchentchen checkout mode (2026-11-05): /paiement shows only Tchentchen's checkout frame and its
-- order hook makes the order (src/app/api/pay/order-hook). Each checkout created for a cart is
-- kept here: the order id chosen in advance (Tchentchen's cart_id), the store, and the promotion
-- code and delivery method the cart was priced with, which Tchentchen's status does not repeat.

create table public.tchentchen_checkouts (
  order_id uuid primary key, -- cart_id at Tchentchen; the order gets this id
  store_id uuid not null references public.stores (id) on delete cascade,
  token text unique, -- tct_... once the session exists
  promo text,
  shipping uuid,
  amount numeric(12, 2) not null, -- the total sent (totals_check.order_total)
  created_at timestamptz not null default now()
);
create index tchentchen_checkouts_created on public.tchentchen_checkouts (created_at);

-- Server only: no policy, no grant.
alter table public.tchentchen_checkouts enable row level security;
revoke all on public.tchentchen_checkouts from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'smallstore_worker') then
    grant select, insert, update, delete on public.tchentchen_checkouts to smallstore_worker;
  end if;
end $$;
