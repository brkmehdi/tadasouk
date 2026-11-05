-- Card payments through Tchentchen's public payments API (2026-11-04), written from its API
-- reference. See src/lib/server/tchentchen.ts.
--
-- A card order can have several Tchentchen payments: a new one each time the buyer's total
-- changed before paying. Tchentchen lists them by reference (the order id), so the order no
-- longer keeps one token that the next payment overwrote. A paid one becomes one row of
-- public.payments, its reference the payment id, recorded once.

alter table public.orders drop column tct_token;

-- What was refunded of a card payment: Tchentchen's amount_refunded, kept in step by the
-- refund call and by the payment.refunded event.
alter table public.payments add column refunded numeric(12, 2) not null default 0;
alter table public.payments add constraint payments_refunded check (refunded >= 0 and refunded <= amount);
create unique index payments_tchentchen_reference on public.payments (reference) where provider = 'tchentchen';

-- Events already handled: Tchentchen may send the same event (same id) twice.
create table public.tchentchen_events (
  id text primary key,
  type text not null,
  payment_id text,
  received_at timestamptz not null default now()
);

-- The keys Tchentchen hands over once, when the platform owner clicks "Connect Tchentchen" in
-- /admin/tchentchen. The Worker encrypts each one (AES-GCM, Cloudflare secret
-- TCHENTCHEN_KEYS_SECRET) before it reaches this table. One row.
create table public.tchentchen_account (
  id boolean primary key default true check (id),
  shop_url text not null,
  sandbox_key text,
  live_key text,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now()
);

-- Server only: no policy, no grant.
alter table public.tchentchen_events enable row level security;
alter table public.tchentchen_account enable row level security;
revoke all on public.tchentchen_events, public.tchentchen_account from anon, authenticated;

-- place_order takes the order id the card payment was made for (p_order_id): the payment is
-- created before the order, with the order id as its reference. A card order needs one.
drop function public.place_order(text, jsonb, text, text, text, text, text, text, uuid, text);
create function public.place_order(
  p_slug text,
  p_items jsonb, -- [{ "product_id": uuid, "quantity": int, "color_id": uuid?, "size": text? }]
  p_name text,
  p_phone text,
  p_city text,
  p_address text,
  p_payment text,
  p_note text,
  p_shipping uuid default null,
  p_promo text default null,
  p_order_id uuid default null
) returns table (order_id uuid, number int, total numeric, store_id uuid)
language plpgsql set search_path = ''
as $$
#variable_conflict use_column
declare
  v_store public.stores%rowtype;
  v_cart jsonb;
  v_customer uuid;
  v_order uuid;
  v_number int;
begin
  select * into v_store from public.stores s where s.slug = p_slug and s.published for update;
  if not found then raise exception 'store_not_found' using errcode = 'P0404'; end if;
  if p_payment not in ('cod', 'credit', 'card') then raise exception 'bad_payment' using errcode = 'P0400'; end if;
  if p_payment = 'card' and (not v_store.card_enabled or p_order_id is null) then raise exception 'payment_off' using errcode = 'P0400'; end if;
  if p_payment = 'cod' and not v_store.cod_enabled then raise exception 'payment_off' using errcode = 'P0400'; end if;
  if p_payment = 'credit' and not v_store.credit_enabled then raise exception 'payment_off' using errcode = 'P0400'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'bad_items' using errcode = 'P0400';
  end if;

  v_cart := public.cart_total(v_store.id, p_items, p_shipping, p_promo);
  if exists (select 1 from jsonb_array_elements(v_cart -> 'lines') l where not (l ->> 'ok')::boolean) then
    raise exception 'bad_items' using errcode = 'P0400';
  end if;
  if nullif(trim(coalesce(p_promo, '')), '') is not null and v_cart ->> 'promo_error' is not null then
    raise exception 'bad_promo' using errcode = 'P0409';
  end if;
  if jsonb_array_length(v_cart -> 'shipping_options') > 0
     and (p_shipping is null or (v_cart -> 'shipping' ->> 'id')::uuid <> p_shipping) then
    raise exception 'bad_shipping' using errcode = 'P0400';
  end if;

  insert into public.customers (store_id, name, phone, city, address)
    values (v_store.id, p_name, p_phone, p_city, p_address)
    on conflict (store_id, phone) do update set name = excluded.name, city = excluded.city, address = excluded.address
    returning id into v_customer;

  update public.stores set order_seq = order_seq + 1 where id = v_store.id returning order_seq into v_number;

  insert into public.orders (id, store_id, number, customer_id, channel, payment_method, credit_status, currency,
    subtotal, shipping_fee, discount, promo_code, total, shipping_method_id, shipping_name,
    customer_name, customer_phone, city, address, note)
  values (coalesce(p_order_id, gen_random_uuid()), v_store.id, v_number, v_customer, 'online', p_payment,
    case when p_payment = 'credit' then 'requested' end, v_store.currency,
    (v_cart ->> 'subtotal')::numeric, coalesce((v_cart -> 'shipping' ->> 'fee')::numeric, 0),
    (v_cart ->> 'discount')::numeric, v_cart ->> 'promo_code', (v_cart ->> 'total')::numeric,
    (v_cart -> 'shipping' ->> 'id')::uuid, v_cart -> 'shipping' ->> 'name',
    p_name, p_phone, p_city, p_address, p_note)
  returning id into v_order;

  insert into public.order_items (order_id, store_id, product_id, name, unit_price, quantity, color, size)
    select v_order, v_store.id, l.product_id, l.name, l.unit_price, l.quantity, l.color, l.size
    from jsonb_to_recordset(v_cart -> 'lines') as l(product_id uuid, name text, unit_price numeric, quantity int, color text, size text);

  if v_cart ->> 'promo_code' is not null then
    update public.promo_codes set uses = uses + 1 where store_id = v_store.id and code = v_cart ->> 'promo_code';
  end if;
  update public.products p set stock = greatest(p.stock - q.n, 0)
    from (select (l ->> 'product_id')::uuid as id, sum((l ->> 'quantity')::int) as n
          from jsonb_array_elements(v_cart -> 'lines') l group by 1) q
    where p.id = q.id and p.stock is not null;

  return query select v_order, v_number, (v_cart ->> 'total')::numeric, v_store.id;
end $$;
revoke execute on function public.place_order from public, anon, authenticated;

-- The Worker's database role (production only) gets the same rights as on the other tables.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'smallstore_worker') then
    grant select, insert, update, delete on public.tchentchen_events, public.tchentchen_account to smallstore_worker;
    grant execute on function public.place_order(text, jsonb, text, text, text, text, text, text, uuid, text, uuid) to smallstore_worker;
  end if;
end $$;
