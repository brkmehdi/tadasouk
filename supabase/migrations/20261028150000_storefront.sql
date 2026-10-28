-- Storefront: each store lives at /{slug} (decided 2026-10-28: a path now; a subdomain per store
-- needs a domain of our own and can come later). The slugs below are the app's own pages.
alter table public.stores add constraint stores_slug_not_reserved check (slug not in (
  'app', 'admin', 'api', 'auth', 'capture', 'connexion', 'media', 'static', 'www', 'login', 'signup',
  'panier', 'cart', 'checkout', 'commande', 'aide', 'help', 'terms', 'privacy', 'about', 'smallstore',
  'robots', 'sitemap', 'manifest', 'favicon', 'icon', 'sw'
));

-- The store's look: a hero photo (uploaded, or made by muse-image on request) and one line.
alter table public.stores add column hero_key text;
alter table public.stores add column tagline text check (length(tagline) <= 140);
grant update (hero_key, tagline) on public.stores to authenticated;

-- An order from the storefront, priced by the database from the published products (the
-- browser only says which products and how many). Called by the server only.
create function public.place_order(
  p_slug text,
  p_items jsonb, -- [{ "product_id": uuid, "quantity": int }]
  p_name text,
  p_phone text,
  p_city text,
  p_address text,
  p_payment text,
  p_note text
) returns table (order_id uuid, number int, total numeric, store_id uuid)
language plpgsql set search_path = ''
as $$
#variable_conflict use_column
declare
  v_store public.stores%rowtype;
  v_customer uuid;
  v_order uuid;
  v_number int;
  v_subtotal numeric := 0;
  v_item record;
begin
  select * into v_store from public.stores s where s.slug = p_slug and s.published for update;
  if not found then raise exception 'store_not_found' using errcode = 'P0404'; end if;
  if p_payment not in ('cod', 'credit') then raise exception 'bad_payment' using errcode = 'P0400'; end if;
  if p_payment = 'cod' and not v_store.cod_enabled then raise exception 'payment_off' using errcode = 'P0400'; end if;
  if p_payment = 'credit' and not v_store.credit_enabled then raise exception 'payment_off' using errcode = 'P0400'; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'bad_items' using errcode = 'P0400'; end if;

  -- Every line must be a published product of this store with a price, in a sane quantity.
  for v_item in
    select i.product_id, i.quantity, p.name, p.price
    from jsonb_to_recordset(p_items) as i(product_id uuid, quantity int)
    left join public.products p on p.id = i.product_id and p.store_id = v_store.id and p.status = 'published'
  loop
    if v_item.name is null or v_item.price is null or v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 99 then
      raise exception 'bad_items' using errcode = 'P0400';
    end if;
    v_subtotal := v_subtotal + v_item.price * v_item.quantity;
  end loop;

  insert into public.customers (store_id, name, phone, city, address)
    values (v_store.id, p_name, p_phone, p_city, p_address)
    on conflict (store_id, phone) do update set name = excluded.name, city = excluded.city, address = excluded.address
    returning id into v_customer;

  update public.stores set order_seq = order_seq + 1 where id = v_store.id returning order_seq into v_number;

  insert into public.orders (store_id, number, customer_id, channel, payment_method, credit_status, currency,
    subtotal, shipping_fee, total, customer_name, customer_phone, city, address, note)
  values (v_store.id, v_number, v_customer, 'online', p_payment,
    case when p_payment = 'credit' then 'requested' end, v_store.currency,
    v_subtotal, 0, v_subtotal, p_name, p_phone, p_city, p_address, p_note)
  returning id into v_order;

  insert into public.order_items (order_id, store_id, product_id, name, unit_price, quantity)
    select v_order, v_store.id, p.id, p.name, p.price, i.quantity
    from jsonb_to_recordset(p_items) as i(product_id uuid, quantity int)
    join public.products p on p.id = i.product_id;

  return query select v_order, v_number, v_subtotal, v_store.id;
end $$;
revoke execute on function public.place_order from public, anon, authenticated;
