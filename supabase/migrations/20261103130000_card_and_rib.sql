-- Card at checkout, and the bank details kept private (2026-11-03).

-- A card order is placed unpaid like the others; the buyer then pays on the TChenTChen checkout
-- and its webhook marks the order paid (src/app/api/pay). Only when the store has card on.
create or replace function public.place_order(
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
  if p_payment not in ('cod', 'credit', 'card') then raise exception 'bad_payment' using errcode = 'P0400'; end if;
  if p_payment = 'card' and not v_store.card_enabled then raise exception 'payment_off' using errcode = 'P0400'; end if;
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

-- The RIB is the merchant's own: published stores are readable by anyone, so every column but
-- the RIB is granted (a new public column must be added here). The owner reads it with
-- my_store_rib(); writing it stays allowed by the update grant of 20261103120000_tools.sql.
revoke select on public.stores from anon, authenticated;
grant select (id, owner_id, name, slug, currency, whatsapp, city, cod_enabled, card_enabled, credit_enabled,
  default_installments, published, order_seq, created_at, hero_key, tagline, marketplace_margin, marketplaces)
  on public.stores to anon, authenticated;

create function public.my_store_rib() returns text
language sql stable security definer set search_path = ''
as $$ select rib from public.stores where owner_id = auth.uid() $$;
revoke execute on function public.my_store_rib() from public, anon;
grant execute on function public.my_store_rib() to authenticated;
