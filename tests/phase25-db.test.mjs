import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';

const db = new PGlite();
const phase2 = await readFile(new URL('../supabase/phase2.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/phase2.5.sql', import.meta.url), 'utf8');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
let legacy, expired, room;
async function identity(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.user_id', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function rpc(name, args = []) {
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as data`, args)).rows[0].data;
}
const create = (amount = 500, time = '07:00', count = 2, date = future) => rpc('wp_create_room_v25', ['朝活', count, date, time, amount]);
const join = target => rpc('wp_join_room_v25', [target.room_code, true, target.wake_at, target.challenge_amount]);
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    create table public.users(id text primary key default gen_random_uuid()::text, nickname text not null, icon text not null default 'cat', created_at timestamp default now());
    create table public.rooms(id text primary key default gen_random_uuid()::text, room_code text unique not null, group_name text not null, max_members integer not null default 4, creator_id text references public.users(id), wake_time time, challenge_amount integer, status text not null default 'waiting', created_at timestamp default now());
    create table public.room_members(id text primary key default gen_random_uuid()::text, room_id text references public.rooms(id), user_id text references public.users(id), approved boolean default false, joined_at timestamp default now());
    create table public.wake_checks(id text primary key default gen_random_uuid()::text, room_id text references public.rooms(id), user_id text references public.users(id), check_number integer not null, checked_at timestamp, deadline timestamp not null);
  `);
  await db.exec(phase2);
  for (let i = 0; i < ids.length; i++) { await identity(ids[i]); await rpc('wp_register', [`利用者${i + 1}`, 'cat']); }
  await identity(ids[0]);
  legacy = await rpc('wp_create_room', ['旧部屋', 4]);
  expired = await rpc('wp_create_room', ['期限切れ', 4]);
  await db.exec('reset role');
  // Represent retained data from an earlier/partial setup without editing a
  // real project's records or bypassing the new immutability rule in production.
  await db.exec('alter table public.rooms add column wake_at timestamptz');
  await db.query("update public.rooms set challenge_amount = 99 where id = $1", [legacy.id]);
  await db.query("update public.rooms set challenge_amount = 500, wake_time = '07:00', wake_at = '2020-01-01T07:00:00+09:00' where id = $1", [expired.id]);
  await db.query('update public.room_members set approved = true where room_id = $1', [expired.id]);
  await db.exec(migration);
});
after(async () => { await db.close(); });

test('migration retains legacy values and approval; old room remains readable but cannot be joined', async () => {
  await identity(ids[0]);
  const detail = await rpc('wp_get_room', [legacy.room_code]);
  assert.equal(detail.room.challenge_amount, 99);
  assert.equal(detail.room.wake_at, null);
  assert.equal(detail.members[0].approved, false);
  await identity(ids[1]);
  const preview = await rpc('wp_preview_room', [legacy.room_code]);
  assert.equal(preview.unavailable_reason, 'conditions_missing'); assert.equal(preview.can_join, false);
  await assert.rejects(() => rpc('wp_join_room_v25', [legacy.room_code, true, null, 99]), /WP_CONDITIONS_MISSING/);
});
test('create accepts inclusive boundaries and stores the exact chosen Japanese date/time', async () => {
  await identity(ids[0]);
  const early = await create(100, '04:00');
  const late = await create(2000, '11:00');
  assert.equal(Date.parse(early.wake_at), Date.parse(`${future}T04:00:00+09:00`));
  assert.equal(Date.parse(late.wake_at), Date.parse(`${future}T11:00:00+09:00`));
  assert.equal(early.challenge_amount, 100); assert.equal(late.challenge_amount, 2000);
  assert.equal((await rpc('wp_get_room', [early.room_code])).members[0].approved, true);
  room = await create();
});
test('create rejects outside limits, missing values, fractional amounts, seconds, invalid and past dates', async () => {
  await identity(ids[0]);
  for (const amount of [99, 2001, null]) await assert.rejects(() => create(amount), /WP_INVALID_INPUT/);
  await assert.rejects(() => create(100.5));
  for (const time of ['03:59', '11:01', '07:00:01', null]) await assert.rejects(() => create(500, time), /WP_INVALID_INPUT/);
  for (const date of [null, '2020-01-01', 'infinity']) await assert.rejects(() => create(500, '07:00', 2, date), /WP_INVALID_INPUT/);
  await assert.rejects(() => create(500, '07:00', 2, '2027-02-29'));
});
test('preview discloses only conditions/count and never adds participants', async () => {
  await identity(ids[1]);
  const first = await rpc('wp_preview_room', [room.room_code.toLowerCase()]);
  assert.equal(first.room.member_count, 1); assert.equal(first.can_join, true);
  assert.equal(first.is_member, false);
  assert.deepEqual(Object.keys(first.room).sort(), ['challenge_amount','group_name','max_members','member_count','room_code','status','wake_at'].sort());
  assert.equal('members' in first, false);
  assert.equal((await rpc('wp_preview_room', [room.room_code])).room.member_count, 1);
  assert.deepEqual(await rpc('wp_my_rooms'), []);
  await assert.rejects(() => rpc('wp_get_room', [room.room_code]), /WP_NOT_MEMBER/);
  await assert.rejects(() => rpc('wp_preview_room', ['INVALID']), /WP_INVALID_INPUT/);
  await assert.rejects(() => rpc('wp_preview_room', ['ZZZZZZ']), /WP_ROOM_NOT_FOUND/);
});
test('declined/missing consent and stale conditions cannot register a member', async () => {
  await identity(ids[1]);
  for (const accepted of [false, null]) await assert.rejects(() => rpc('wp_join_room_v25', [room.room_code, accepted, room.wake_at, 500]), /WP_ACCEPTANCE_REQUIRED/);
  await assert.rejects(() => rpc('wp_join_room_v25', [room.room_code, true, room.wake_at, 600]), /WP_CONDITIONS_CHANGED/);
  await assert.rejects(() => rpc('wp_join_room_v25', [room.room_code, true, `${future}T08:00:00+09:00`, 500]), /WP_CONDITIONS_CHANGED/);
  await assert.rejects(() => rpc('wp_join_room_v25', [room.room_code, true, null, 500]), /WP_CONDITIONS_CHANGED/);
  assert.equal((await rpc('wp_preview_room', [room.room_code])).room.member_count, 1);
});
test('last accepted join transitions to ready, retry is idempotent, and no alarm data is created', async () => {
  await identity(ids[1]);
  const result = await rpc('wp_join_room_v25', [room.room_code, true, `${future}T07:00:00+09:00`, 500]);
  assert.equal(result.status, 'ready');
  assert.equal((await join(room)).status, 'ready');
  const detail = await rpc('wp_get_room', [room.room_code]);
  assert.equal(detail.members.length, 2); assert.equal(detail.members.every(m => m.approved), true);
  const preview = await rpc('wp_preview_room', [room.room_code]);
  assert.equal(preview.is_member, true); assert.equal(preview.can_join, false);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.wake_checks')).rows[0].n, 0);
});
test('full/closed, expired, and incomplete rooms cannot accept a new user', async () => {
  await identity(ids[2]);
  await assert.rejects(() => join(room), /WP_ROOM_CLOSED/);
  const expiredPreview = await rpc('wp_preview_room', [expired.room_code]);
  assert.equal(expiredPreview.unavailable_reason, 'expired');
  await assert.rejects(() => rpc('wp_join_room_v25', [expired.room_code, true, expiredPreview.room.wake_at, 500]), /WP_ROOM_EXPIRED/);
  await db.exec('reset role');
  await db.query("update public.rooms set status = 'waiting' where id = $1", [room.id]);
  await identity(ids[2]);
  assert.equal((await rpc('wp_preview_room', [room.room_code])).unavailable_reason, 'full');
  await assert.rejects(() => join(room), /WP_ROOM_FULL/);
});
test('conditions cannot change or be cleared, but same-value and status-only updates work', async () => {
  await db.exec('reset role');
  for (const sql of ["challenge_amount = 600", "wake_time = '08:00'", "wake_at = wake_at + interval '1 day'", 'wake_at = null']) {
    await assert.rejects(() => db.query(`update public.rooms set ${sql} where id = $1`, [room.id]), /WP_CONDITIONS_IMMUTABLE/);
  }
  await db.query('update public.rooms set challenge_amount = challenge_amount where id = $1', [room.id]);
  await db.query("update public.rooms set status = 'ready' where id = $1", [room.id]);
});
test('new RPCs deny unauthenticated clients; old RPCs and direct writes are disabled', async () => {
  await identity(null, 'anon');
  await assert.rejects(() => rpc('wp_preview_room', [room.room_code]), /permission denied/);
  await assert.rejects(() => create(), /permission denied/);
  await assert.rejects(() => join(room), /permission denied/);
  await identity(ids[2]);
  await assert.rejects(() => rpc('wp_create_room', ['旧入口', 2]), /permission denied/);
  await assert.rejects(() => rpc('wp_join_room', [room.room_code]), /permission denied/);
  await assert.rejects(() => db.query('select * from public.rooms'), /permission denied/);
  await assert.rejects(() => db.query("update public.rooms set challenge_amount = 100"), /permission denied/);
});
test('owner membership failure rolls back the room', async () => {
  await db.exec('reset role');
  const count = (await db.query('select count(*)::int as n from public.rooms')).rows[0].n;
  await db.exec(`create function public.test_fail_member() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_FAILURE'; end; $$;
    create trigger test_fail_member before insert on public.room_members for each row execute function public.test_fail_member();`);
  await identity(ids[0]); await assert.rejects(() => create(), /SIMULATED_FAILURE/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.rooms')).rows[0].n, count);
  await db.exec('drop trigger test_fail_member on public.room_members; drop function public.test_fail_member()');
});
test('migration rerun preserves data and cannot re-enable old paths', async () => {
  await db.exec('reset role'); await db.exec(migration);
  await identity(ids[1]);
  assert.equal((await rpc('wp_get_room', [room.room_code])).members.length, 2);
  await assert.rejects(() => rpc('wp_create_room', ['旧入口', 2]), /permission denied/);
  // Accidental reapplication of the old migration must still not allow bypass.
  await db.exec('reset role'); await db.exec(phase2);
  await identity(ids[0]);
  await assert.rejects(() => rpc('wp_create_room', ['旧入口', 2]), /WP_INVALID_INPUT/);
  const openRoom = await create(500, '07:00', 4);
  await identity(ids[2]);
  await assert.rejects(() => rpc('wp_join_room', [openRoom.room_code]), /WP_ACCEPTANCE_REQUIRED/);
  await db.exec('reset role'); await db.exec(migration);
});
