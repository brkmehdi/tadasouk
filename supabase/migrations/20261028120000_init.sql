-- SmallStore: merchants, stores, catalogue, customers, orders, payments, credit book, shipping
-- and AI credit.
--
-- Row level security on every table. A merchant reads and writes only the rows of their own
-- store; anyone reads published stores and products; orders, payments and AI usage are written
-- by the server (Postgres through Hyperdrive, which bypasses RLS and checks ownership itself).

-- ---------------------------------------------------------------------------------------------
-- People and stores
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'merchant' check (role in ('merchant', 'admin')),
  full_name text,
  phone text,
  signup_method text not null default 'email', -- google | email | phone
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade, -- one store per merchant
  name text not null check (length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  currency text not null default 'MAD',
  whatsapp text,
  city text,
  cod_enabled boolean not null default true,
  card_enabled boolean not null default false,
  credit_enabled boolean not null default false,
  default_installments int not null default 3 check (default_installments between 2 and 12),
  published boolean not null default false,
  order_seq int not null default 0, -- last order number given (per store numbering)
  created_at timestamptz not null default now()
);

-- The caller's store, for policies. Security definer so policies on other tables can use it
-- without a policy loop on stores.
create function public.my_store_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.stores where owner_id = auth.uid() $$;

-- ---------------------------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null default '',
  name_ar text,
  description text,
  category text,
  price numeric(12, 2) check (price >= 0),
  compare_at_price numeric(12, 2) check (compare_at_price >= 0),
  stock int check (stock >= 0),
  barcode text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  ai_filled jsonb not null default '{}',
  price_check jsonb,
  capture_ref text, -- id of the product in the capture session, so saving again updates it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, capture_ref)
);
create index products_store_status on public.products (store_id, status);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade, -- copied for policies
  r2_key text not null,
  source text not null check (source in ('camera', 'studio', 'ai', 'web')),
  label text,
  credit text,
  position int not null default 0,
  quality jsonb,
  created_at timestamptz not null default now()
);
create index product_images_product on public.product_images (product_id, position);

-- ---------------------------------------------------------------------------------------------
-- Customers, shipping, orders, payments
-- ---------------------------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  phone text not null,
  city text,
  address text,
  credit_limit numeric(12, 2) not null default 0 check (credit_limit >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (store_id, phone)
);

create table public.shipping_methods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  cities text[] not null default '{}', -- empty: every city
  price numeric(12, 2) not null default 0 check (price >= 0),
  free_over numeric(12, 2) check (free_over >= 0),
  delay_days int check (delay_days >= 0),
  active boolean not null default true,
  position int not null default 0
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  number int not null,
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null check (channel in ('online', 'counter')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  payment_method text not null check (payment_method in ('cod', 'card', 'card_counter', 'cash', 'credit')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid', 'refunded')),
  credit_status text check (credit_status in ('requested', 'approved', 'refused')),
  currency text not null default 'MAD',
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  shipping_fee numeric(12, 2) not null default 0 check (shipping_fee >= 0),
  total numeric(12, 2) not null check (total >= 0),
  customer_name text,
  customer_phone text,
  city text,
  address text,
  location text, -- "lat,lng" when the buyer shared it
  shipping_method_id uuid references public.shipping_methods (id) on delete set null,
  shipping_name text,
  tracking text,
  tct_token text unique, -- TChenTChen checkout token for card payments
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number)
);
create index orders_store_created on public.orders (store_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name text not null, -- copied at order time
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0)
);

-- ---------------------------------------------------------------------------------------------
-- Credit book: what each customer owes, and installment plans
-- ---------------------------------------------------------------------------------------------

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid unique references public.orders (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  count int not null check (count between 1 and 24),
  interval_days int not null default 30 check (interval_days > 0),
  created_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.installment_plans (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  due_on date not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz,
  reminded_at timestamptz
);
create index installments_due on public.installments (store_id, due_on) where paid_at is null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  installment_id uuid references public.installments (id) on delete set null,
  method text not null check (method in ('cash', 'card', 'card_counter', 'transfer')),
  provider text not null default 'cash' check (provider in ('cash', 'tchentchen')),
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  received_at timestamptz not null default now()
);

-- + what the customer owes (a sale on credit), - what they paid back.
create table public.credit_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  kind text not null check (kind in ('sale', 'payment', 'adjustment')),
  amount numeric(12, 2) not null check (amount <> 0),
  note text,
  created_at timestamptz not null default now()
);
create index credit_entries_customer on public.credit_entries (store_id, customer_id, created_at);

-- Card payments land on the platform's TChenTChen account; the platform then pays merchants.
create table public.merchant_payouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

-- ---------------------------------------------------------------------------------------------
-- Phone sign-in: codes waiting for the merchant to write on WhatsApp (server only)
-- ---------------------------------------------------------------------------------------------

create table public.phone_codes (
  phone text primary key, -- E.164 without "+", as Supabase sends it
  code text not null,
  expires_at timestamptz not null,
  sent_at timestamptz
);

-- ---------------------------------------------------------------------------------------------
-- AI credit: a free allowance per day (set by the server), then a prepaid balance
-- ---------------------------------------------------------------------------------------------

create table public.ai_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance_usd numeric(12, 6) not null default 0 check (balance_usd >= 0),
  updated_at timestamptz not null default now()
);

create table public.ai_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('topup', 'gift', 'adjustment')),
  amount_usd numeric(12, 6) not null,
  reference text unique, -- TChenTChen token for a top-up, so a webhook replay adds nothing
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.api_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  session_id text,
  model text not null,
  endpoint text not null,
  estimate_usd numeric(12, 6) not null,
  cost_usd numeric(12, 6),
  free_usd numeric(12, 6), -- part paid by the day's free allowance
  paid_usd numeric(12, 6), -- part taken from the balance
  status text not null default 'pending' check (status in ('pending', 'done')),
  ok boolean,
  latency_ms int,
  detail jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index api_usage_user_day on public.api_usage (user_id, created_at);

-- The day resets at midnight in Morocco.
create function public.ai_day_start() returns timestamptz
language sql stable set search_path = ''
as $$ select date_trunc('day', now() at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca' $$;

create function public.ai_free_used(p_user uuid) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce(sum(free_usd), 0) from public.api_usage
  where user_id = p_user and status = 'done' and created_at >= public.ai_day_start()
$$;

-- What the user can still spend now: free left today + balance - calls in flight.
create function public.ai_status(p_user uuid, p_free numeric)
returns table (free_left numeric, balance numeric, pending numeric, available numeric)
language plpgsql stable set search_path = ''
as $$
declare
  v_balance numeric;
  v_pending numeric;
  v_free_left numeric;
begin
  select coalesce((select w.balance_usd from public.ai_wallets w where w.user_id = p_user), 0) into v_balance;
  select coalesce(sum(estimate_usd), 0) into v_pending from public.api_usage
    where user_id = p_user and status = 'pending' and created_at > now() - interval '10 minutes';
  v_free_left := greatest(0, p_free - public.ai_free_used(p_user));
  return query select v_free_left, v_balance, v_pending, greatest(0, v_free_left + v_balance - v_pending);
end $$;

-- Before a model call: hold its estimate, or refuse when the user has not enough left.
create function public.ai_reserve(p_user uuid, p_session text, p_model text, p_endpoint text, p_estimate numeric, p_free numeric)
returns bigint
language plpgsql set search_path = ''
as $$
declare
  v_available numeric;
  v_id bigint;
begin
  insert into public.ai_wallets (user_id) values (p_user) on conflict do nothing;
  perform 1 from public.ai_wallets where user_id = p_user for update; -- one call at a time per user
  select s.available into v_available from public.ai_status(p_user, p_free) s;
  if p_estimate > v_available then
    raise exception 'ai_credit_exhausted' using errcode = 'P0402', detail = v_available::text;
  end if;
  insert into public.api_usage (user_id, session_id, model, endpoint, estimate_usd)
    values (p_user, p_session, p_model, p_endpoint, p_estimate)
    returning id into v_id;
  return v_id;
end $$;

-- After the call: charge the real cost, from the free allowance first, then the balance.
create function public.ai_settle(p_usage bigint, p_cost numeric, p_ok boolean, p_latency int, p_detail jsonb, p_free numeric)
returns table (free_left numeric, balance numeric, pending numeric, available numeric)
language plpgsql set search_path = ''
as $$
declare
  v_user uuid;
  v_free_part numeric;
  v_paid_part numeric;
begin
  select user_id into v_user from public.api_usage where id = p_usage and status = 'pending';
  if v_user is null then
    return; -- already settled
  end if;
  perform 1 from public.ai_wallets where user_id = v_user for update;
  v_free_part := least(p_cost, greatest(0, p_free - public.ai_free_used(v_user)));
  v_paid_part := p_cost - v_free_part;
  update public.ai_wallets
    set balance_usd = greatest(0, balance_usd - v_paid_part), updated_at = now()
    where user_id = v_user;
  update public.api_usage
    set cost_usd = p_cost, free_usd = v_free_part, paid_usd = v_paid_part, status = 'done',
        ok = p_ok, latency_ms = p_latency, detail = p_detail, settled_at = now()
    where id = p_usage;
  return query select * from public.ai_status(v_user, p_free);
end $$;

-- Top-ups and gifts add to the balance once (the reference makes a replay a no-op).
create function public.ai_add_credit(p_user uuid, p_kind text, p_amount numeric, p_reference text, p_by uuid)
returns boolean
language plpgsql set search_path = ''
as $$
begin
  insert into public.ai_credits (user_id, kind, amount_usd, reference, created_by)
    values (p_user, p_kind, p_amount, p_reference, p_by)
    on conflict (reference) do nothing;
  if not found then
    return false;
  end if;
  insert into public.ai_wallets (user_id, balance_usd) values (p_user, greatest(0, p_amount))
    on conflict (user_id) do update
    set balance_usd = greatest(0, public.ai_wallets.balance_usd + p_amount), updated_at = now();
  return true;
end $$;

-- These run only from the server, never from a browser session.
revoke execute on function public.ai_status, public.ai_reserve, public.ai_settle, public.ai_add_credit,
  public.ai_free_used from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- New user: a profile and an empty AI wallet
-- ---------------------------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, full_name, signup_method)
  values (
    new.id,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_app_meta_data ->> 'provider', 'email')
  );
  insert into public.ai_wallets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.customers enable row level security;
alter table public.shipping_methods enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.installment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.credit_entries enable row level security;
alter table public.merchant_payouts enable row level security;
alter table public.phone_codes enable row level security; -- no policy: server only
alter table public.ai_wallets enable row level security;
alter table public.ai_credits enable row level security;
alter table public.api_usage enable row level security;

-- Grants are explicit: nothing is open unless listed here (and a policy allows the row).
revoke all on all tables in schema public from anon, authenticated;

-- profiles: read and rename yourself; the role never changes from a browser.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "rename self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- stores: anyone reads published stores; the owner creates and edits theirs.
grant select on public.stores to anon, authenticated;
grant insert (owner_id, name, slug, currency, whatsapp, city) on public.stores to authenticated;
grant update (name, slug, currency, whatsapp, city, cod_enabled, card_enabled, credit_enabled,
  default_installments, published) on public.stores to authenticated;
create policy "published stores" on public.stores for select to anon, authenticated using (published);
create policy "own store" on public.stores for select to authenticated using (owner_id = auth.uid());
create policy "open my store" on public.stores for insert to authenticated with check (owner_id = auth.uid());
create policy "edit my store" on public.stores for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- products and their images: published ones are public; the owner does everything.
grant select on public.products, public.product_images to anon, authenticated;
grant insert, update, delete on public.products, public.product_images to authenticated;
create policy "published products" on public.products for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.stores s where s.id = store_id and s.published));
create policy "my products" on public.products for all to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());
create policy "published images" on public.product_images for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.stores s on s.id = p.store_id
    where p.id = product_id and p.status = 'published' and s.published));
create policy "my images" on public.product_images for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.products p where p.id = product_id and p.store_id = public.my_store_id()));

-- shipping methods: active ones of published stores are public (the checkout lists them).
grant select on public.shipping_methods to anon, authenticated;
grant insert, update, delete on public.shipping_methods to authenticated;
create policy "public shipping" on public.shipping_methods for select to anon, authenticated
  using (active and exists (select 1 from public.stores s where s.id = store_id and s.published));
create policy "my shipping" on public.shipping_methods for all to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());

-- customers and the credit book: the owner only.
grant select, insert, update, delete on public.customers, public.credit_entries,
  public.installment_plans, public.installments to authenticated;
create policy "my customers" on public.customers for all to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());
create policy "my credit book" on public.credit_entries for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.customers c where c.id = customer_id and c.store_id = public.my_store_id()));
create policy "my plans" on public.installment_plans for all to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());
create policy "my installments" on public.installments for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.installment_plans p where p.id = plan_id and p.store_id = public.my_store_id()));

-- orders: created by the server; the owner reads them and moves them along.
grant select on public.orders, public.order_items to authenticated;
grant update (status, payment_status, credit_status, tracking, shipping_name, note,
  customer_name, customer_phone, city, address) on public.orders to authenticated;
create policy "my orders" on public.orders for select to authenticated using (store_id = public.my_store_id());
create policy "move my orders" on public.orders for update to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());
create policy "my order lines" on public.order_items for select to authenticated using (store_id = public.my_store_id());

-- payments: the owner reads them and records cash; card payments come from the server.
grant select, insert on public.payments to authenticated;
create policy "my payments" on public.payments for select to authenticated using (store_id = public.my_store_id());
create policy "record cash" on public.payments for insert to authenticated
  with check (store_id = public.my_store_id() and provider = 'cash'
    and (order_id is null or exists (select 1 from public.orders o where o.id = order_id and o.store_id = public.my_store_id())));

-- payouts and AI credit: read your own.
grant select on public.merchant_payouts, public.ai_wallets, public.ai_credits, public.api_usage to authenticated;
create policy "my payouts" on public.merchant_payouts for select to authenticated using (store_id = public.my_store_id());
create policy "my wallet" on public.ai_wallets for select to authenticated using (user_id = auth.uid());
create policy "my credits" on public.ai_credits for select to authenticated using (user_id = auth.uid());
create policy "my usage" on public.api_usage for select to authenticated using (user_id = auth.uid());
