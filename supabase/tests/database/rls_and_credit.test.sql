-- Row level security and AI credit. Run with: npx supabase test db
begin;
select plan(27);

-- How many welcome credits were given before this test (the first 10 accounts get $2).
create temp table before_welcome as select count(*)::int as n from public.ai_credits where kind = 'welcome';

-- Two merchants, as Supabase Auth would create them (the trigger makes profile + wallet).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@test.ma', '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.ma', '{"provider":"google"}', '{"full_name":"Bouchra"}', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2, 'a profile per new user');
select is((select signup_method from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'google', 'sign-up method kept');
select is((select count(*)::int from public.ai_wallets where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')), 2, 'an AI wallet per new user');
select is(
  (select balance_usd from public.ai_wallets where user_id = '11111111-1111-1111-1111-111111111111'),
  (select case when n < 10 then 2.000000 else 0 end from before_welcome)::numeric(12, 6),
  'the first 10 accounts get $2 of AI at sign-up, later ones nothing');
select is(
  (select ai_access from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  (select case when n < 10 then 'active' else 'pending' end from before_welcome),
  'later accounts wait for activation');

-- Merchant A opens a store and adds things, as the browser would.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into public.stores (owner_id, name, slug) values (auth.uid(), 'Hanout A', 'hanout-a');
select lives_ok(
  $$ insert into public.products (store_id, name, price, status) values (public.my_store_id(), 'Huile d''argan', 120, 'published') $$,
  'A adds a product to its store');
insert into public.products (store_id, name, price) values (public.my_store_id(), 'Brouillon', 10);
insert into public.customers (store_id, name, phone) values (public.my_store_id(), 'Client A', '212600000001');
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = auth.uid() $$,
  '42501', null, 'a merchant cannot make itself admin');
select throws_ok(
  $$ insert into public.orders (store_id, number, channel, payment_method, subtotal, total)
     values (public.my_store_id(), 1, 'online', 'cod', 10, 10) $$,
  '42501', null, 'orders are created by the server only');
select throws_ok(
  $$ insert into public.payments (store_id, method, provider, amount) values (public.my_store_id(), 'card', 'tchentchen', 50) $$,
  '42501', null, 'card payments come from the server only');
select lives_ok(
  $$ insert into public.payments (store_id, method, provider, amount) values (public.my_store_id(), 'cash', 'cash', 50) $$,
  'the merchant records cash');

-- Merchant B sees none of A's private rows and cannot write into A's store.
reset role;
create temp table a_store as select id from public.stores where slug = 'hanout-a';
grant select on a_store to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.stores (owner_id, name, slug) values (auth.uid(), 'Hanout B', 'hanout-b');
select is((select count(*)::int from public.customers), 0, 'B sees no customer of A');
select is((select count(*)::int from public.payments), 0, 'B sees no payment of A');
select is((select count(*)::int from public.products where store_id = (select id from a_store)), 0, 'B sees no product of an unpublished store');
select throws_ok(
  $$ insert into public.products (store_id, name) values ((select id from a_store), 'intrus') $$,
  '42501', null, 'B cannot add a product to A''s store');
select throws_ok(
  $$ select public.ai_add_credit(auth.uid(), 'gift', 100, 'self-gift', auth.uid()) $$,
  '42501', null, 'a browser session cannot give itself AI credit');

-- A publishes: visitors see the published product, never the draft or the customers.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.stores set published = true where owner_id = auth.uid();
reset role;
set local role anon;
select is((select count(*)::int from public.products where store_id = (select id from a_store)), 1, 'a visitor sees only the published product');
select throws_ok($$ select count(*) from public.customers $$, '42501', null, 'a visitor cannot read customers at all');
reset role;

-- Orders from the storefront: priced by the database from published products only.
select is(
  (select total from public.place_order('hanout-a',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Huile d''argan'), 'quantity', 2)),
     'Salma', '212612345678', 'Fès', '12 rue', 'cod', null)),
  240.00::numeric, 'an order is priced from the published product (2 x 120)');
select throws_ok(
  $$ select * from public.place_order('hanout-a',
       jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Brouillon'), 'quantity', 1)),
       'Salma', '212612345678', 'Fès', '12 rue', 'cod', null) $$,
  'P0400', null, 'a draft cannot be ordered');
select throws_ok(
  $$ select * from public.place_order('no-such-store', '[]'::jsonb, 'S', '2126', 'F', 'r', 'cod', null) $$,
  'P0404', null, 'an unknown or offline store takes no order');

-- Activation by the owner gives the $2 once.
update public.ai_wallets set balance_usd = 0 where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.ai_credits where user_id = '22222222-2222-2222-2222-222222222222';
update public.profiles set ai_access = 'pending' where id = '22222222-2222-2222-2222-222222222222';
select ok(public.ai_activate('22222222-2222-2222-2222-222222222222', null), 'activating gives the welcome credit');
select is(
  (select balance_usd from public.ai_wallets where user_id = '22222222-2222-2222-2222-222222222222')
  + case when public.ai_activate('22222222-2222-2222-2222-222222222222', null) then 100 else 0 end,
  2.000000::numeric(12, 6), 'a second activation adds nothing');

-- AI credit, as the server calls it: 0.50 free per day, then the balance, then refused.
update public.ai_wallets set balance_usd = 0 where user_id = '11111111-1111-1111-1111-111111111111';
select ok(public.ai_reserve('11111111-1111-1111-1111-111111111111', 's1', 'muse-image-1.0', 't', 0.40, 0.50) > 0, 'a call within the free allowance is held');
select is(
  (select round(free_left, 2) from public.ai_settle(
     (select max(id) from public.api_usage), 0.40, true, 100, '{}', 0.50)),
  0.10, 'the real cost comes off the free allowance');
select throws_ok(
  $$ select public.ai_reserve('11111111-1111-1111-1111-111111111111', 's1', 'muse-image-1.0', 't', 0.20, 0.50) $$,
  'P0402', null, 'a call above what is left is refused');
select ok(public.ai_add_credit('11111111-1111-1111-1111-111111111111', 'topup', 10, 'tct_test_1', null), 'a top-up adds once');
select is(
  (select round(available, 2) from public.ai_status('11111111-1111-1111-1111-111111111111', 0.50))
  + case when public.ai_add_credit('11111111-1111-1111-1111-111111111111', 'topup', 10, 'tct_test_1', null) then 100 else 0 end,
  10.10, 'free left + balance; a replayed top-up adds nothing');

select * from finish();
rollback;
