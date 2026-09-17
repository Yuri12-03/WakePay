-- Apply AFTER phase3.sql. Accept every minute of the day; retain future-date,
-- Japan timezone, consent, immutable conditions, and automatic-start rules.
-- Does not change existing room conditions or restart any room.
begin;
lock table public.rooms, public.room_members, public.wake_checks in share row exclusive mode;
alter table public.rooms drop constraint if exists wp_wake_time_range;
alter table public.rooms add constraint wp_wake_time_range check (
  wake_time between time '00:00' and time '23:59' and extract(second from wake_time) = 0
) not valid;

create or replace function public.wp_guard_room_conditions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.wake_at is distinct from old.wake_at
      or new.wake_time is distinct from old.wake_time
      or new.challenge_amount is distinct from old.challenge_amount then
      raise exception 'WP_CONDITIONS_IMMUTABLE';
    end if;
  else
    -- Also blocks the legacy creation RPC if phase2.sql is accidentally reapplied.
    if new.wake_at is null or not isfinite(new.wake_at) or new.wake_at <= clock_timestamp()
      or new.wake_time is null or new.wake_time not between time '00:00' and time '23:59'
      or extract(second from new.wake_time) <> 0
      or new.challenge_amount is null or new.challenge_amount not between 100 and 2000
      or (new.wake_at at time zone 'Asia/Tokyo')::time <> new.wake_time then
      raise exception 'WP_INVALID_INPUT';
    end if;
  end if;
  return new;
end; $$;

create or replace function public.wp_room_unavailable_reason(p_room public.rooms) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_room.wake_at is null or not isfinite(p_room.wake_at)
    or p_room.challenge_amount is null or p_room.challenge_amount not between 100 and 2000
    or p_room.wake_time is null or p_room.wake_time not between time '00:00' and time '23:59'
    or extract(second from p_room.wake_time) <> 0
    or (p_room.wake_at at time zone 'Asia/Tokyo')::time <> p_room.wake_time
    or exists (select 1 from public.room_members where room_id = p_room.id and approved is not true)
    then return 'conditions_missing'; end if;
  if p_room.wake_at <= clock_timestamp() then return 'expired'; end if;
  if p_room.status <> 'waiting' then return 'closed'; end if;
  if (select count(*) from public.room_members where room_id = p_room.id) >= p_room.max_members then return 'full'; end if;
  return null;
end; $$;

create or replace function public.wp_create_room_v25(
  p_group_name text, p_max_members integer, p_wake_date date,
  p_wake_time time, p_challenge_amount integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare new_room public.rooms; scheduled_at timestamptz; attempt integer;
begin
  perform public.wp_current_user();
  if p_group_name is null or length(btrim(p_group_name)) not between 1 and 40
    or p_max_members is null or p_max_members not between 2 and 8
    or p_wake_date is null or not isfinite(p_wake_date) or extract(year from p_wake_date) not between 1 and 9999
    or p_wake_time is null or p_wake_time not between time '00:00' and time '23:59' or extract(second from p_wake_time) <> 0
    or p_challenge_amount is null or p_challenge_amount not between 100 and 2000 then
    raise exception 'WP_INVALID_INPUT';
  end if;
  scheduled_at := (p_wake_date + p_wake_time) at time zone 'Asia/Tokyo';
  if scheduled_at <= clock_timestamp() then raise exception 'WP_INVALID_INPUT'; end if;
  for attempt in 1..10 loop
    begin
      insert into public.rooms(room_code, group_name, max_members, creator_id, wake_time, wake_at, challenge_amount)
      values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), btrim(p_group_name), p_max_members,
        auth.uid()::text, p_wake_time, scheduled_at, p_challenge_amount)
      returning * into new_room;
      insert into public.room_members(room_id, user_id, approved) values (new_room.id, auth.uid()::text, true);
      return to_jsonb(new_room);
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
  raise exception 'WP_CREATE_FAILED';
end; $$;

create or replace function public.wp_start_room(p_room_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; member_count integer; all_approved boolean;
begin
  select * into target from public.rooms where id = p_room_id for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if target.status in ('active', 'finished') then return to_jsonb(target); end if;
  if target.status not in ('waiting', 'ready') then raise exception 'WP_ROOM_CLOSED'; end if;
  if target.wake_at is null or not isfinite(target.wake_at)
    or target.wake_time is null or target.wake_time not between time '00:00' and time '23:59'
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

revoke all on function public.wp_guard_room_conditions() from public, anon, authenticated;
revoke all on function public.wp_room_unavailable_reason(public.rooms) from public, anon, authenticated;
revoke all on function public.wp_start_room(text) from public, anon, authenticated;
revoke all on function public.wp_create_room_v25(text, integer, date, time, integer) from public, anon;
grant execute on function public.wp_create_room_v25(text, integer, date, time, integer) to authenticated;
commit;
