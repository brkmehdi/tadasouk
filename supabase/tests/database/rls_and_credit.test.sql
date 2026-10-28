-- Row level security and AI credit. Run with: npx supabase test db
begin;
select plan(20);

-- Two merchants, as Supabase Auth would create them (the trigger makes profile + wallet).
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@test.ma', '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.ma', '{"provider":"google"}', '{"full_name":"Bouchra"}', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles), 2, 'a profile per new user');
select is((select signup_method from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'google', 'sign-up method kept');
select is((select count(*)::int from public.ai_wallets), 2, 'an AI wallet per new user');

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
grant select on a_store to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.stores (owner_id, name, slug) values (auth.uid(), 'Hanout B', 'hanout-b');
select is((select count(*)::int from public.customers), 0, 'B sees no customer of A');
select is((select count(*)::int from public.payments), 0, 'B sees no payment of A');
select is((select count(*)::int from public.products), 0, 'B sees no product of an unpublished store');
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
select is((select count(*)::int from public.products), 1, 'a visitor sees only the published product');
select throws_ok($$ select count(*) from public.customers $$, '42501', null, 'a visitor cannot read customers at all');
reset role;

-- AI credit, as the server calls it: 0.50 free per day, then the balance, then refused.
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
