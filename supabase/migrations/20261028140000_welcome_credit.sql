-- AI credit policy (owner's choice, 2026-10-28): every new account gets $2 of AI usage once,
-- automatically for the first 10 accounts; later accounts wait until the platform owner activates
-- them from /admin (which gives them the same $2). The daily free allowance is set to 0 in
-- wrangler.jsonc (AI_FREE_DAILY_USD), so an account spends only its balance.

alter table public.ai_credits drop constraint ai_credits_kind_check;
alter table public.ai_credits add constraint ai_credits_kind_check
  check (kind in ('topup', 'gift', 'adjustment', 'welcome'));

-- pending: waits for the owner; active: has received its welcome credit.
alter table public.profiles add column ai_access text not null default 'pending'
  check (ai_access in ('pending', 'active'));
-- The admin list needs the address an account signed up with (auth.users is not readable there).
alter table public.profiles add column email text;

update public.profiles p set email = u.email from auth.users u where u.id = p.id;
update public.profiles p set ai_access = 'active'
  where exists (select 1 from public.ai_credits c where c.user_id = p.id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_welcome boolean;
begin
  -- One sign-up at a time decides who is among the first 10.
  perform pg_advisory_xact_lock(hashtext('smallstore.welcome_credit'));
  v_welcome := (select count(*) from public.ai_credits where kind = 'welcome') < 10;
  insert into public.profiles (id, phone, email, full_name, signup_method, ai_access)
  values (
    new.id,
    new.phone,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_app_meta_data ->> 'provider', 'email'),
    case when v_welcome then 'active' else 'pending' end
  );
  insert into public.ai_wallets (user_id) values (new.id) on conflict do nothing;
  if v_welcome then
    perform public.ai_add_credit(new.id, 'welcome', 2, 'welcome-' || new.id, null);
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The owner activates a waiting account: it gets its $2 once (a second click adds nothing).
create function public.ai_activate(p_user uuid, p_by uuid) returns boolean
language plpgsql set search_path = ''
as $$
declare
  v_added boolean;
begin
  update public.profiles set ai_access = 'active' where id = p_user;
  v_added := public.ai_add_credit(p_user, 'welcome', 2, 'welcome-' || p_user, p_by);
  return v_added;
end $$;
revoke execute on function public.ai_activate from public, anon, authenticated;

-- The merchant may read its own access state (the back office shows it).
grant select (ai_access, email) on public.profiles to authenticated;
