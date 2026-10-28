-- Security advisor follow-up: security definer functions are not callable through the API
-- unless they have to be. The sign-up trigger runs only as a trigger; my_store_id() stays
-- callable by signed-in users because their row level security policies call it (it only
-- returns the caller's own store id).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.my_store_id() from public, anon;
grant execute on function public.my_store_id() to authenticated;
