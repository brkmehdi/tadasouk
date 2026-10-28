-- Colours and sizes, delivery and promotion codes in the cart price and the order.
begin;
select plan(17);

insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'v2@test.ma');
insert into public.stores (owner_id, name, slug, published) values ('33333333-3333-3333-3333-333333333333', 'Dar V2', 'dar-v2', true);
create temp table s as select id from public.stores where slug = 'dar-v2';
insert into public.products (store_id, name, price, status, sizes)
  values ((select id from s), 'Hoodie', 200, 'published', '{S,M,L}'),
         ((select id from s), 'Thé', 40, 'published', '{}');
create temp table hoodie as select id from public.products where name = 'Hoodie' and store_id = (select id from s);
create temp table tea as select id from public.products where name = 'Thé' and store_id = (select id from s);
insert into public.product_colors (product_id, store_id, name, hex)
  values ((select id from hoodie), (select id from s), 'Noir', '#111111'),
         ((select id from hoodie), (select id from s), 'Sable', '#d8cbb3');
create temp table black as select id from public.product_colors where name = 'Noir' and product_id = (select id from hoodie);
update public.products set soldout = array[(select id from black)::text || ':L'] where id = (select id from hoodie);
insert into public.shipping_methods (store_id, name, price, free_over, position)
  values ((select id from s), 'Standard', 30, 300, 0), ((select id from s), 'Express', 60, null, 1);
insert into public.promo_codes (store_id, code, kind, value, min_subtotal)
  values ((select id from s), 'DIX', 'percent', 10, 0), ((select id from s), 'CENT', 'amount', 100, 500);
insert into public.promo_codes (store_id, code, kind, value, ends_at)
  values ((select id from s), 'VIEUX', 'percent', 20, now() - interval '1 day');

create function pg_temp.item(p uuid, q int, c uuid, sz text) returns jsonb language sql as
  $$ select jsonb_strip_nulls(jsonb_build_object('product_id', p, 'quantity', q, 'color_id', c, 'size', sz)) $$;

-- Lines
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 1, (select id from black), 'M'))) -> 'lines' -> 0 ->> 'ok')::boolean,
  true, 'a colour and a size of the product can be ordered');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 1, (select id from black), 'L'))) -> 'lines' -> 0 ->> 'ok')::boolean,
  false, 'a sold-out combination cannot');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 1, null, 'M'))) -> 'lines' -> 0 ->> 'ok')::boolean,
  false, 'a product with colours needs one');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 1, (select id from black), 'XXL'))) -> 'lines' -> 0 ->> 'ok')::boolean,
  false, 'a size outside the list is refused');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 2, null, null))) -> 'lines' -> 0 ->> 'ok')::boolean,
  true, 'a product without options needs none');

-- Delivery
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 2, null, null))) ->> 'total')::numeric,
  110::numeric, 'the first method is chosen by default (80 + 30)');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 2, (select id from black), 'S'))) ->> 'total')::numeric,
  400::numeric, 'standard is free from 300');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 2, (select id from black), 'S')),
    (select id from public.shipping_methods where name = 'Express' and store_id = (select id from s))) ->> 'total')::numeric,
  460::numeric, 'express is never free');

-- Promotion codes
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 2, null, null)), null, ' dix ') ->> 'discount')::numeric,
  8::numeric, 'a percentage code, typed loosely, takes 10%');
select is(public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 2, null, null)), null, 'CENT') ->> 'promo_error',
  'minimum', 'an amount code below its minimum is refused');
select is((public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from hoodie), 3, (select id from black), 'S')), null, 'CENT') ->> 'total')::numeric,
  500::numeric, '600 - 100, and standard stays free on 500');
select is(public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 1, null, null)), null, 'VIEUX') ->> 'promo_error',
  'expired', 'an expired code is refused');
select is(public.quote_cart('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 1, null, null)), null, 'NOPE') ->> 'promo_error',
  'unknown', 'an unknown code is refused');

-- The order
select is(
  (select total from public.place_order('dar-v2',
     jsonb_build_array(pg_temp.item((select id from hoodie), 1, (select id from black), 'M'), pg_temp.item((select id from tea), 1, null, null)),
     'Salma', '212612345678', 'Fès', '12 rue', 'cod', null,
     (select id from public.shipping_methods where name = 'Standard' and store_id = (select id from s)), 'dix')),
  246::numeric, '240 - 24 + 30: the order keeps the code and the delivery');
select is(
  (select row(o.discount, o.promo_code, o.shipping_fee, o.shipping_name, (select string_agg(i.color || '/' || i.size, ',') from public.order_items i where i.order_id = o.id))::text
   from public.orders o where o.store_id = (select id from s)),
  '(24.00,DIX,30.00,Standard,Noir/M)', 'the order stores discount, code, delivery and the colour and size of its lines');
select throws_ok(
  $$ select * from public.place_order('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 1, null, null)),
       'S', '212612345678', 'Fès', '12 rue', 'cod', null, null, 'VIEUX') $$,
  'P0409', null, 'an order with a code that no longer works is refused');
select throws_ok(
  $$ select * from public.place_order('dar-v2', jsonb_build_array(pg_temp.item((select id from tea), 1, null, null)),
       'S', '212612345678', 'Fès', '12 rue', 'cod', null, null, null) $$,
  'P0400', null, 'a store with delivery methods needs one chosen');

select * from finish();
rollback;
