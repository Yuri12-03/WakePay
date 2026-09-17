-- Phase 2.5 migration. Apply AFTER phase2.sql; deploy with the Phase 2.5 app.
-- Existing rooms and memberships are retained, not automatically approved.
-- Old creation/join RPCs are disabled. Phase 3 automatic start is not included.
begin;

alter table public.rooms add column if not exists wake_at timestamptz;

-- NOT VALID retains old null/out-of-range data while protecting new writes.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.rooms'::regclass and conname = 'wp_amount_range') then
    alter table public.rooms add constraint wp_amount_range check (challenge_amount between 100 and 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rooms'::regclass and conname = 'wp_wake_time_range') then
    alter table public.rooms add constraint wp_wake_time_range check (
      wake_time between time '04:00' and time '11:00' and extract(second from wake_time) = 0
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rooms'::regclass and conname = 'wp_wake_at_consistent') then
    alter table public.rooms add constraint wp_wake_at_consistent check (
      wake_at is null or (isfinite(wake_at) and wake_time is not null and challenge_amount is not null
        and (wake_at at time zone 'Asia/Tokyo')::time = wake_time)
    ) not valid;
  end if;
end; $$;

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
      or new.wake_time is null or new.wake_time not between time '04:00' and time '11:00'
      or extract(second from new.wake_time) <> 0
      or new.challenge_amount is null or new.challenge_amount not between 100 and 2000
      or (new.wake_at at time zone 'Asia/Tokyo')::time <> new.wake_time then
      raise exception 'WP_INVALID_INPUT';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists wp_guard_room_conditions on public.rooms;
create trigger wp_guard_room_conditions before insert or update on public.rooms
for each row execute function public.wp_guard_room_conditions();

-- Private helper; do not expose the composite rooms row through an RPC grant.
create or replace function public.wp_room_unavailable_reason(p_room public.rooms) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_room.wake_at is null or not isfinite(p_room.wake_at)
    or p_room.challenge_amount is null or p_room.challenge_amount not between 100 and 2000
    or p_room.wake_time is null or p_room.wake_time not between time '04:00' and time '11:00'
    or extract(second from p_room.wake_time) <> 0
    or (p_room.wake_at at time zone 'Asia/Tokyo')::time <> p_room.wake_time
    or exists (select 1 from public.room_members where room_id = p_room.id and approved is not true)
    then return 'conditions_missing'; end if;
  if p_room.wake_at <= clock_timestamp() then return 'expired'; end if;
  if p_room.status <> 'waiting' then return 'closed'; end if;
  if (select count(*) from public.room_members where room_id = p_room.id) >= p_room.max_members then return 'full'; end if;
  return null;
end; $$;

create or replace function public.wp_guard_member_conditions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; reason text;
begin
  -- Serialize all member insert paths, including accidentally re-enabled old RPCs.
  select * into target from public.rooms where id = new.room_id for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if new.approved is not true then raise exception 'WP_ACCEPTANCE_REQUIRED'; end if;
  reason := public.wp_room_unavailable_reason(target);
  if reason = 'conditions_missing' then raise exception 'WP_CONDITIONS_MISSING'; end if;
  if reason = 'expired' then raise exception 'WP_ROOM_EXPIRED'; end if;
  if reason = 'closed' then raise exception 'WP_ROOM_CLOSED'; end if;
  if reason = 'full' then raise exception 'WP_ROOM_FULL'; end if;
  return new;
end; $$;
drop trigger if exists wp_guard_member_conditions on public.room_members;
create trigger wp_guard_member_conditions before insert on public.room_members
for each row execute function public.wp_guard_member_conditions();

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
    or p_wake_time is null or p_wake_time not between time '04:00' and time '11:00' or extract(second from p_wake_time) <> 0
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

create or replace function public.wp_preview_room(p_room_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; member_count integer; already_member boolean; reason text;
begin
  perform public.wp_current_user();
  if p_room_code is null or upper(btrim(p_room_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'WP_INVALID_INPUT'; end if;
  -- Lock prevents mixed snapshots of room status and membership count during a join.
  select * into target from public.rooms where room_code = upper(btrim(p_room_code)) for share;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  select count(*), coalesce(bool_or(user_id = auth.uid()::text), false) into member_count, already_member
    from public.room_members where room_id = target.id;
  reason := public.wp_room_unavailable_reason(target);
  return jsonb_build_object(
    'room', jsonb_build_object('room_code', target.room_code, 'group_name', target.group_name,
      'max_members', target.max_members, 'member_count', member_count,
      'wake_at', target.wake_at, 'challenge_amount', target.challenge_amount, 'status', target.status),
    'is_member', already_member, 'can_join', not already_member and reason is null,
    'unavailable_reason', reason
  );
end; $$;

create or replace function public.wp_join_room_v25(
  p_room_code text, p_accepted boolean,
  p_expected_wake_at timestamptz, p_expected_challenge_amount integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.rooms; reason text; member_count integer; all_approved boolean;
begin
  perform public.wp_current_user();
  if p_room_code is null or upper(btrim(p_room_code)) !~ '^[A-Z0-9]{6}$' then raise exception 'WP_INVALID_INPUT'; end if;
  select * into target from public.rooms where room_code = upper(btrim(p_room_code)) for update;
  if not found then raise exception 'WP_ROOM_NOT_FOUND'; end if;
  if exists(select 1 from public.room_members where room_id = target.id and user_id = auth.uid()::text)
    then return to_jsonb(target); end if;
  if p_accepted is not true then raise exception 'WP_ACCEPTANCE_REQUIRED'; end if;
  if target.wake_at is null or target.challenge_amount is null then raise exception 'WP_CONDITIONS_MISSING'; end if;
  if p_expected_wake_at is null or p_expected_challenge_amount is null
    or target.wake_at is distinct from p_expected_wake_at
    or target.challenge_amount is distinct from p_expected_challenge_amount then raise exception 'WP_CONDITIONS_CHANGED'; end if;
  reason := public.wp_room_unavailable_reason(target);
  if reason = 'conditions_missing' then raise exception 'WP_CONDITIONS_MISSING'; end if;
  if reason = 'expired' then raise exception 'WP_ROOM_EXPIRED'; end if;
  if reason = 'closed' then raise exception 'WP_ROOM_CLOSED'; end if;
  if reason = 'full' then raise exception 'WP_ROOM_FULL'; end if;
  insert into public.room_members(room_id, user_id, approved) values (target.id, auth.uid()::text, true);
  select count(*), coalesce(bool_and(approved is true), false) into member_count, all_approved
    from public.room_members where room_id = target.id;
  if member_count = target.max_members and all_approved then
    -- Phase 3 will atomically create wake_checks and transition to active here.
    update public.rooms set status = 'ready' where id = target.id returning * into target;
  end if;
  return to_jsonb(target);
end; $$;

-- Keep the migration safe to re-run without restoring legacy entry points.
revoke all on function public.wp_create_room(text, integer) from public, anon, authenticated;
revoke all on function public.wp_join_room(text) from public, anon, authenticated;
revoke all on function public.wp_guard_room_conditions() from public, anon, authenticated;
revoke all on function public.wp_guard_member_conditions() from public, anon, authenticated;
revoke all on function public.wp_room_unavailable_reason(public.rooms) from public, anon, authenticated;
revoke all on function public.wp_create_room_v25(text, integer, date, time, integer) from public, anon;
revoke all on function public.wp_preview_room(text) from public, anon;
revoke all on function public.wp_join_room_v25(text, boolean, timestamptz, integer) from public, anon;
grant execute on function public.wp_create_room_v25(text, integer, date, time, integer) to authenticated;
grant execute on function public.wp_preview_room(text) to authenticated;
grant execute on function public.wp_join_room_v25(text, boolean, timestamptz, integer) to authenticated;

commit;
