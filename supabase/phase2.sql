-- Apply after the four tables in the technical design have been created.
-- No existing data is deleted. Run this entire file as one transaction.
-- Existing duplicate memberships must be resolved by the DB owner first.
begin;

create unique index if not exists wp_unique_membership on public.room_members(room_id, user_id);
create index if not exists wp_members_by_user on public.room_members(user_id);

-- Clients access only the RPC functions below. A bare publishable key cannot
-- read or write profiles, rooms, or confirmations directly.
alter table public.users enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.wake_checks enable row level security;
revoke all on public.users, public.rooms, public.room_members, public.wake_checks from anon, authenticated;

create or replace function public.wp_current_user() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare profile public.users;
begin
  if auth.uid() is null then raise exception 'WP_UNAUTHORIZED'; end if;
  select * into profile from public.users where id = auth.uid()::text;
  if not found then raise exception 'WP_PROFILE_REQUIRED'; end if;
  return to_jsonb(profile);
end; $$;

create or replace function public.wp_register(p_nickname text, p_icon text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'WP_UNAUTHORIZED'; end if;
  if p_nickname is null or length(btrim(p_nickname)) not between 1 and 20
    or p_icon is null or p_icon not in ('cat','dog','rabbit','panda','bear','fox','koala','penguin')
    then raise exception 'WP_INVALID_INPUT'; end if;
  -- Identity comes from the verified Supabase Auth JWT, never a supplied ID.
  insert into public.users(id, nickname, icon) values (auth.uid()::text, btrim(p_nickname), p_icon)
    on conflict (id) do nothing;
  return public.wp_current_user();
end; $$;

create or replace function public.wp_create_room(p_group_name text, p_max_members integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare new_room public.rooms; attempt integer;
begin
  perform public.wp_current_user();
  if p_group_name is null or length(btrim(p_group_name)) not between 1 and 40
    or p_max_members is null or p_max_members not between 2 and 8 then raise exception 'WP_INVALID_INPUT'; end if;
  for attempt in 1..10 loop
    begin
      insert into public.rooms(room_code, group_name, max_members, creator_id)
      values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), btrim(p_group_name), p_max_members, auth.uid()::text)
      returning * into new_room;
      -- Creation and owner membership commit together, or both roll back.
      insert into public.room_members(room_id, user_id) values (new_room.id, auth.uid()::text);
      return to_jsonb(new_room);
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
  raise exception 'WP_CREATE_FAILED';
end; $$;

create or replace function public.wp_join_room(p_room_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; member_count integer;
begin
  perform public.wp_current_user();
  if p_room_code is null or upper(btrim(p_room_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'WP_INVALID_INPUT'; end if;
  -- Lock this room to serialize concurrent joins, including the last place.
  select * into target from public.rooms where room_code = upper(btrim(p_room_code)) for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if exists(select 1 from public.room_members where room_id = target.id and user_id = auth.uid()::text)
    then return to_jsonb(target); end if;
  if target.status <> 'waiting' then raise exception 'WP_ROOM_CLOSED'; end if;
  select count(*) into member_count from public.room_members where room_id = target.id;
  if member_count >= target.max_members then raise exception 'WP_ROOM_FULL'; end if;
  insert into public.room_members(room_id, user_id) values (target.id, auth.uid()::text);
  return to_jsonb(target);
end; $$;

create or replace function public.wp_get_room(p_room_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; members jsonb;
begin
  perform public.wp_current_user();
  select * into target from public.rooms where room_code = upper(btrim(p_room_code));
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if not exists(select 1 from public.room_members where room_id = target.id and user_id = auth.uid()::text)
    then raise exception 'WP_NOT_MEMBER'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'user_id', m.user_id, 'approved', m.approved, 'joined_at', m.joined_at,
    'user', to_jsonb(u)) order by m.joined_at, m.id), '[]'::jsonb) into members
  from public.room_members m join public.users u on u.id = m.user_id where m.room_id = target.id;
  return jsonb_build_object('room', to_jsonb(target), 'members', members);
end; $$;

create or replace function public.wp_my_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.wp_current_user();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id), '[]'::jsonb) into result
  from public.rooms r where exists(select 1 from public.room_members m where m.room_id = r.id and m.user_id = auth.uid()::text);
  return result;
end; $$;

revoke all on function public.wp_current_user() from public, anon;
revoke all on function public.wp_register(text, text) from public, anon;
revoke all on function public.wp_create_room(text, integer) from public, anon;
revoke all on function public.wp_join_room(text) from public, anon;
revoke all on function public.wp_get_room(text) from public, anon;
revoke all on function public.wp_my_rooms() from public, anon;
grant execute on function public.wp_current_user() to authenticated;
grant execute on function public.wp_register(text, text) to authenticated;
grant execute on function public.wp_create_room(text, integer) to authenticated;
grant execute on function public.wp_join_room(text) to authenticated;
grant execute on function public.wp_get_room(text) to authenticated;
grant execute on function public.wp_my_rooms() to authenticated;

commit;
