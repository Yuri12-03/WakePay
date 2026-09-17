-- Apply after Phase 2.5, together with the Phase 3 app. Run as one transaction.
-- If existing timestamp values exist, the DB owner must specify their proven
-- timezone below (e.g. UTC or Asia/Tokyo). Empty tables need no assumption.
begin;
set local wakepay.legacy_timestamp_zone = '';
lock table public.rooms, public.room_members, public.wake_checks in share row exclusive mode;

do $$
declare col text; kind text; has_values boolean;
  legacy_zone text := current_setting('wakepay.legacy_timestamp_zone');
begin
  foreach col in array array['checked_at', 'deadline'] loop
    select data_type into kind from information_schema.columns
      where table_schema = 'public' and table_name = 'wake_checks' and column_name = col;
    if kind = 'timestamp without time zone' then
      execute format('select exists(select 1 from public.wake_checks where %I is not null)', col) into has_values;
      if has_values and legacy_zone = '' then
        raise exception 'WP_LEGACY_TIMEZONE_REQUIRED: verify the timezone of existing wake_checks before migration';
      end if;
      execute format('alter table public.wake_checks alter column %I type timestamptz using %I at time zone %L',
        col, col, coalesce(nullif(legacy_zone, ''), 'UTC'));
    elsif kind is distinct from 'timestamp with time zone' then
      raise exception 'WP_UNEXPECTED_TIMESTAMP_TYPE';
    end if;
  end loop;
end; $$;

-- Invalid existing data stops the transaction; never delete or guess a repair.
alter table public.wake_checks alter column room_id set not null;
alter table public.wake_checks alter column user_id set not null;
create unique index if not exists wp_unique_wake_check on public.wake_checks(room_id, user_id, check_number);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.wake_checks'::regclass and conname = 'wp_check_number_range') then
    alter table public.wake_checks add constraint wp_check_number_range check (check_number between 1 and 3);
  end if;
end; $$;
alter table public.wake_checks enable row level security;
revoke all on public.wake_checks from anon, authenticated;

-- Internal only: caller holds the room lock; locking again is safe.
create or replace function public.wp_start_room(p_room_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; member_count integer; all_approved boolean;
begin
  select * into target from public.rooms where id = p_room_id for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if target.status in ('active', 'finished') then return to_jsonb(target); end if;
  if target.status not in ('waiting', 'ready') then raise exception 'WP_ROOM_CLOSED'; end if;
  if target.wake_at is null or not isfinite(target.wake_at)
    or target.wake_time is null or target.wake_time not between time '04:00' and time '11:00'
    or extract(second from target.wake_time) <> 0
    or (target.wake_at at time zone 'Asia/Tokyo')::time <> target.wake_time
    or target.challenge_amount is null or target.challenge_amount not between 100 and 2000
    then raise exception 'WP_CONDITIONS_MISSING'; end if;
  if target.wake_at <= clock_timestamp() then raise exception 'WP_ROOM_EXPIRED'; end if;
  select count(*), coalesce(bool_and(approved is true), false) into member_count, all_approved
    from public.room_members where room_id = target.id;
  if target.max_members not between 2 and 8 or member_count <> target.max_members or not all_approved
    then raise exception 'WP_START_NOT_READY'; end if;

  insert into public.wake_checks(room_id, user_id, check_number, deadline)
    select target.id, m.user_id, n, target.wake_at + n * interval '10 minutes'
    from public.room_members m cross join generate_series(1, 3) n where m.room_id = target.id
    on conflict (room_id, user_id, check_number) do nothing;
  if (select count(*) from public.wake_checks where room_id = target.id) <> member_count * 3
    or exists (select 1 from public.wake_checks c where c.room_id = target.id
      and (c.checked_at is not null or c.deadline <> target.wake_at + c.check_number * interval '10 minutes'
        or not exists (select 1 from public.room_members m where m.room_id = target.id and m.user_id = c.user_id)))
    then raise exception 'WP_CHECK_DATA_CONFLICT'; end if;
  -- Recheck after data creation so an expired room cannot become active.
  if target.wake_at <= clock_timestamp() then raise exception 'WP_ROOM_EXPIRED'; end if;
  update public.rooms set status = 'active' where id = target.id returning * into target;
  return to_jsonb(target);
end; $$;
revoke all on function public.wp_start_room(text) from public, anon, authenticated;

-- Same arguments and response contract as Phase 2.5; no extra browser request.
create or replace function public.wp_join_room_v25(
  p_room_code text, p_accepted boolean, p_expected_wake_at timestamptz, p_expected_challenge_amount integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; member_count integer;
begin
  perform public.wp_current_user();
  if p_room_code is null or upper(btrim(p_room_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'WP_INVALID_INPUT'; end if;
  select * into target from public.rooms where room_code = upper(btrim(p_room_code)) for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if exists(select 1 from public.room_members where room_id = target.id and user_id = auth.uid()::text)
    then return jsonb_build_object('room', to_jsonb(target)); end if;
  if p_accepted is not true then raise exception 'WP_ACCEPTANCE_REQUIRED'; end if;
  if target.wake_at is null or target.challenge_amount is null then raise exception 'WP_CONDITIONS_MISSING'; end if;
  if p_expected_wake_at is distinct from target.wake_at
    or p_expected_challenge_amount is distinct from target.challenge_amount then raise exception 'WP_CONDITIONS_CHANGED'; end if;
  if target.wake_at <= clock_timestamp() then raise exception 'WP_ROOM_EXPIRED'; end if;
  if target.status <> 'waiting' then raise exception 'WP_ROOM_CLOSED'; end if;
  if exists(select 1 from public.room_members where room_id = target.id and approved is not true)
    then raise exception 'WP_CONDITIONS_MISSING'; end if;
  select count(*) into member_count from public.room_members where room_id = target.id;
  if member_count >= target.max_members then raise exception 'WP_ROOM_FULL'; end if;
  insert into public.room_members(room_id, user_id, approved) values (target.id, auth.uid()::text, true);
  if member_count + 1 = target.max_members then
    perform public.wp_start_room(target.id);
    select * into target from public.rooms where id = target.id;
  end if;
  return jsonb_build_object('room', to_jsonb(target));
end; $$;
revoke all on function public.wp_join_room_v25(text, boolean, timestamptz, integer) from public, anon;
grant execute on function public.wp_join_room_v25(text, boolean, timestamptz, integer) to authenticated;

-- Read-only, membership checked before exposing room or schedule information.
create or replace function public.wp_waiting_room(p_room_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; checks jsonb;
begin
  perform public.wp_current_user();
  select * into target from public.rooms where room_code = upper(btrim(p_room_code)) for share;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if not exists(select 1 from public.room_members where room_id = target.id and user_id = auth.uid()::text)
    then raise exception 'WP_NOT_MEMBER'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('check_number', c.check_number,
    'opens_at', c.deadline - interval '10 minutes', 'deadline', c.deadline) order by c.check_number), '[]'::jsonb)
    into checks from public.wake_checks c where c.room_id = target.id and c.user_id = auth.uid()::text;
  if target.status in ('active', 'finished') and (jsonb_array_length(checks) <> 3
    or exists(select 1 from public.wake_checks c where c.room_id = target.id and c.user_id = auth.uid()::text
      and c.deadline is distinct from target.wake_at + c.check_number * interval '10 minutes'))
    then raise exception 'WP_CHECK_DATA_CONFLICT'; end if;
  return jsonb_build_object('room', to_jsonb(target), 'checks', checks, 'server_now', clock_timestamp());
end; $$;
revoke all on function public.wp_waiting_room(text) from public, anon;
grant execute on function public.wp_waiting_room(text) to authenticated;

-- Ready rooms created in Phase 2.5: migrate only complete, approved, future rooms.
-- Expired/legacy/incomplete rooms are retained without starting or charging WP.
do $$ declare item record; begin
  for item in select r.id from public.rooms r where r.status = 'ready'
    and r.wake_at > clock_timestamp() and isfinite(r.wake_at)
    and r.max_members between 2 and 8 and r.challenge_amount between 100 and 2000
    and r.wake_time between time '04:00' and time '11:00' and extract(second from r.wake_time) = 0
    and (r.wake_at at time zone 'Asia/Tokyo')::time = r.wake_time
    and (select count(*) from public.room_members m where m.room_id = r.id) = r.max_members
    and not exists(select 1 from public.room_members m where m.room_id = r.id and m.approved is not true)
  loop
    begin
      perform public.wp_start_room(item.id);
    exception when raise_exception then
      if SQLERRM <> 'WP_ROOM_EXPIRED' then raise; end if;
    end;
  end loop;
end; $$;
commit;
