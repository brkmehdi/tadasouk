-- Merchant tools (2026-11-03): stock movements seen by the camera, deliveries, marketplace
-- stock with a safety margin, and the bank details sent with credit reminders.

-- The store's bank details (RIB), sent in WhatsApp reminders; marketplaces see the stock minus a
-- safety margin (percent) to absorb miscounts; which marketplaces the merchant switched on.
alter table public.stores add column rib text check (length(rib) <= 80);
alter table public.stores add column marketplace_margin int not null default 20 check (marketplace_margin between 0 and 90);
alter table public.stores add column marketplaces jsonb not null default '{}';
grant update (rib, marketplace_margin, marketplaces) on public.stores to authenticated;

-- Every stock change with where it came from. The camera writes sales (-) and deliveries (+);
-- a shelf count or the merchant writes corrections. A movement undone keeps its row
-- (reverted_at), so the camera's accuracy can be measured.
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  delta int not null check (delta <> 0),
  source text not null check (source in ('camera_sale', 'camera_delivery', 'shelf_count', 'counter_sale', 'correction')),
  confidence numeric(3, 2) check (confidence between 0 and 1),
  note text,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);
create index stock_movements_store on public.stock_movements (store_id, created_at desc);

-- One delivery per order: the partner, its fee, a tracking code the customer can open, and the
-- steps so far ([{ "status": ..., "at": ... }]).
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  partner text not null,
  kind text not null check (kind in ('local', 'intercity')),
  fee numeric(12, 2) not null default 0 check (fee >= 0),
  from_city text,
  to_city text,
  tracking text not null unique check (tracking ~ '^[A-Z0-9-]{6,20}$'),
  status text not null default 'created' check (status in ('created', 'picked_up', 'in_transit', 'delivered', 'failed')),
  events jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;
alter table public.shipments enable row level security;
grant select, insert, update, delete on public.stock_movements, public.shipments to authenticated;
create policy "my stock movements" on public.stock_movements for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.products p where p.id = product_id and p.store_id = public.my_store_id()));
create policy "my shipments" on public.shipments for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.orders o where o.id = order_id and o.store_id = public.my_store_id()));

-- The Worker's database role (production only) gets the same rights as on the other tables.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'smallstore_worker') then
    grant select, insert, update, delete on public.stock_movements, public.shipments to smallstore_worker;
  end if;
end $$;
