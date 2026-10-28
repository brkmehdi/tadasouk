-- Store v2: colours and sizes, promotion codes, delivery methods in the price, and one cart
-- calculation shared by the cart page (quote_cart) and the order (place_order).

-- Colours of a product; each photo may belong to one colour (shown when the buyer picks it).
create table public.product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade, -- copied for policies
  name text not null check (length(name) between 1 and 40),
  hex text not null default '#cccccc' check (hex ~ '^#[0-9a-fA-F]{6}$'),
  position int not null default 0,
  unique (product_id, name)
);
create index product_colors_product on public.product_colors (product_id);
alter table public.product_images add column color_id uuid references public.product_colors (id) on delete set null;

-- Sizes in the order they are shown (empty: one size), and the sold-out combinations as
-- "<colour id or empty>:<size or empty>".
alter table public.products add column sizes text[] not null default '{}'
  check (cardinality(sizes) <= 20 and array_position(sizes, '') is null);
alter table public.products add column soldout text[] not null default '{}';

-- Promotion codes, typed by the buyer at the cart or the checkout. Only the owner reads them;
-- buyers learn whether a code works through quote_cart.
create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value numeric(12, 2) not null check (value > 0 and (kind = 'amount' or value <= 90)),
  min_subtotal numeric(12, 2) not null default 0 check (min_subtotal >= 0),
  ends_at timestamptz,
  max_uses int check (max_uses > 0),
  uses int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

alter table public.orders add column discount numeric(12, 2) not null default 0 check (discount >= 0);
alter table public.orders add column promo_code text;
alter table public.order_items add column color text;
alter table public.order_items add column size text;

alter table public.product_colors enable row level security;
alter table public.promo_codes enable row level security;
grant select on public.product_colors to anon, authenticated;
grant insert, update, delete on public.product_colors to authenticated;
create policy "published colours" on public.product_colors for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.stores s on s.id = p.store_id
    where p.id = product_id and p.status = 'published' and s.published));
create policy "my colours" on public.product_colors for all to authenticated
  using (store_id = public.my_store_id())
  with check (store_id = public.my_store_id()
    and exists (select 1 from public.products p where p.id = product_id and p.store_id = public.my_store_id()));
grant select, insert, update, delete on public.promo_codes to authenticated;
create policy "my promo codes" on public.promo_codes for all to authenticated
  using (store_id = public.my_store_id()) with check (store_id = public.my_store_id());

-- The cart, priced by the database. Items: [{product_id, quantity, color_id?, size?}].
-- Each line says whether it can be ordered (published, priced, a colour and size of the
-- product, not sold out, enough stock). The promotion applies to the subtotal; delivery is free
-- when what is left after the promotion reaches the method's threshold.
create function public.cart_total(p_store uuid, p_items jsonb, p_shipping uuid, p_promo text)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_lines jsonb := '[]';
  v_sub numeric := 0;
  v_item record;
  v_ok boolean;
  v_code text := nullif(upper(trim(coalesce(p_promo, ''))), '');
  v_promo public.promo_codes%rowtype;
  v_promo_error text;
  v_discount numeric := 0;
  v_after numeric;
  v_options jsonb;
  v_ship public.shipping_methods%rowtype;
  v_fee numeric := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'bad_items' using errcode = 'P0400';
  end if;

  for v_item in
    select i.product_id, i.quantity, i.color_id, nullif(trim(i.size), '') as size,
           p.id as pid, p.name, p.price, p.sizes, p.soldout, p.stock, c.id as cid, c.name as color_name,
           exists (select 1 from public.product_colors x where x.product_id = p.id) as has_colors,
           (select im.r2_key from public.product_images im where im.product_id = p.id
              order by (im.color_id is not distinct from i.color_id) desc, im.position limit 1) as image
    from rows from (jsonb_to_recordset(p_items) as (product_id uuid, quantity int, color_id uuid, size text))
      with ordinality as i(product_id, quantity, color_id, size, n)
    left join public.products p on p.id = i.product_id and p.store_id = p_store and p.status = 'published'
    left join public.product_colors c on c.id = i.color_id and c.product_id = p.id
    order by i.n
  loop
    v_ok := v_item.pid is not null and v_item.price is not null
      and coalesce(v_item.quantity, 0) between 1 and 99
      and case when v_item.has_colors then v_item.cid is not null else v_item.color_id is null end
      and case when cardinality(v_item.sizes) > 0 then v_item.size = any (v_item.sizes) else v_item.size is null end
      and not (coalesce(v_item.color_id::text, '') || ':' || coalesce(v_item.size, '') = any (v_item.soldout))
      and (v_item.stock is null or v_item.stock >= v_item.quantity);
    if v_ok then v_sub := v_sub + v_item.price * v_item.quantity; end if;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_item.product_id, 'color_id', v_item.color_id, 'color', v_item.color_name,
      'size', v_item.size, 'name', v_item.name, 'unit_price', v_item.price,
      'quantity', v_item.quantity, 'image', v_item.image, 'ok', coalesce(v_ok, false));
  end loop;

  if v_code is not null then
    select * into v_promo from public.promo_codes x where x.store_id = p_store and x.code = v_code and x.active;
    if not found then v_promo_error := 'unknown';
    elsif v_promo.ends_at is not null and v_promo.ends_at < now() then v_promo_error := 'expired';
    elsif v_promo.max_uses is not null and v_promo.uses >= v_promo.max_uses then v_promo_error := 'used_up';
    elsif v_sub < v_promo.min_subtotal then v_promo_error := 'minimum';
    else
      v_discount := case v_promo.kind when 'percent' then round(v_sub * v_promo.value / 100, 2)
                                       else least(v_promo.value, v_sub) end;
    end if;
  end if;
  v_after := v_sub - v_discount;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'price', s.price, 'free_over', s.free_over, 'delay_days', s.delay_days,
           'fee', case when s.free_over is not null and v_after >= s.free_over then 0 else s.price end)
           order by s.position, s.price), '[]')
    into v_options
    from public.shipping_methods s where s.store_id = p_store and s.active;
  if jsonb_array_length(v_options) > 0 then
    select * into v_ship from public.shipping_methods s where s.store_id = p_store and s.active and s.id = p_shipping;
    if not found then
      select * into v_ship from public.shipping_methods s where s.store_id = p_store and s.active
        order by s.position, s.price limit 1;
    end if;
    v_fee := case when v_ship.free_over is not null and v_after >= v_ship.free_over then 0 else v_ship.price end;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal', v_sub,
    'discount', v_discount,
    'promo_code', case when v_code is not null and v_promo_error is null then v_code end,
    'promo_error', v_promo_error,
    'shipping', case when v_ship.id is not null then jsonb_build_object('id', v_ship.id, 'name', v_ship.name, 'fee', v_fee) end,
    'shipping_options', v_options,
    'total', v_after + v_fee);
end $$;
revoke execute on function public.cart_total from public, anon, authenticated;

-- What the cart and checkout pages show (the server calls it for the buyer).
create function public.quote_cart(p_slug text, p_items jsonb, p_shipping uuid default null, p_promo text default null)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  select * into v_store from public.stores s where s.slug = p_slug and s.published;
  if not found then raise exception 'store_not_found' using errcode = 'P0404'; end if;
  return public.cart_total(v_store.id, p_items, p_shipping, p_promo) || jsonb_build_object('currency', v_store.currency);
end $$;
revoke execute on function public.quote_cart from public, anon, authenticated;

-- An order, priced by cart_total and refused if anything changed since the buyer looked:
-- a line no longer orderable, a code no longer valid (P0409), a delivery method gone.
drop function public.place_order(text, jsonb, text, text, text, text, text, text);
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
  p_promo text default null
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
  if p_payment not in ('cod', 'credit') then raise exception 'bad_payment' using errcode = 'P0400'; end if;
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

  insert into public.orders (store_id, number, customer_id, channel, payment_method, credit_status, currency,
    subtotal, shipping_fee, discount, promo_code, total, shipping_method_id, shipping_name,
    customer_name, customer_phone, city, address, note)
  values (v_store.id, v_number, v_customer, 'online', p_payment,
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
    grant select, insert, update, delete on public.product_colors, public.promo_codes to smallstore_worker;
    grant execute on function public.cart_total(uuid, jsonb, uuid, text),
      public.quote_cart(text, jsonb, uuid, text),
      public.place_order(text, jsonb, text, text, text, text, text, text, uuid, text) to smallstore_worker;
  end if;
end $$;
