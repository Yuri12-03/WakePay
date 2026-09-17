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

const phase3 = await readFile(new URL('../supabase/phase3.sql', import.meta.url), 'utf8');
const anyTime = await readFile(new URL('../supabase/phase3-any-time.sql', import.meta.url), 'utf8');

test('phase3 migrates ready rooms, preserves expired and legacy rooms', async () => {
  await identity(ids[0]);
  room = await create();
  await identity(ids[1]);
  assert.equal((await join(room)).status, 'ready');
  await db.exec('reset role');
  await db.exec(phase3);
  await identity(ids[0]);
  const waiting = await rpc('wp_waiting_room', [room.room_code]);
  assert.equal(waiting.room.status, 'active');
  assert.equal(waiting.checks.length, 3);
  assert.ok(Number.isFinite(Date.parse(waiting.server_now)));
  assert.equal((await rpc('wp_get_room', [expired.room_code])).room.status, 'waiting');
  assert.equal((await rpc('wp_get_room', [legacy.room_code])).room.wake_at, null);
});

test('all-day migration permits midnight and late night through create, preview, join, and start', async () => {
  await db.exec('reset role'); await db.exec(anyTime);
  for (const time of ['00:00', '03:59', '11:01', '23:59']) {
    await identity(ids[0]);
    const created = await create(500, time);
    assert.equal((await rpc('wp_waiting_room', [created.room_code])).checks.length, 0);
    await identity(ids[1]);
    assert.equal((await rpc('wp_preview_room', [created.room_code])).can_join, true);
    assert.equal((await join(created)).room.status, 'active');
    assert.equal((await join(created)).room.status, 'active');
    const waiting = await rpc('wp_waiting_room', [created.room_code]);
    for (const [i, check] of waiting.checks.entries()) {
      assert.equal(Date.parse(check.opens_at), Date.parse(created.wake_at) + i * 600000);
      assert.equal(Date.parse(check.deadline), Date.parse(created.wake_at) + (i + 1) * 600000);
    }
    await db.exec('reset role');
    const rows = (await db.query('select * from public.wake_checks where room_id = $1', [created.id])).rows;
    assert.equal(rows.length, 6); assert.ok(rows.every(c => c.checked_at === null));
    await identity(ids[2]); await assert.rejects(() => join(created), /WP_ROOM_CLOSED/);
  }
});

test('invalid times, past dates, consent bypass and condition edits stay forbidden', async () => {
  await identity(ids[0]);
  for (const time of ['24:00', '12:00:01']) await assert.rejects(() => create(500, time), /WP_INVALID_INPUT/);
  await assert.rejects(() => create(500, '00:00', 2, '2020-01-01'), /WP_INVALID_INPUT/);
  const created = await create(500, '23:59');
  await identity(ids[1]);
  await assert.rejects(() => rpc('wp_join_room_v25', [created.room_code, false, created.wake_at, 500]), /WP_ACCEPTANCE_REQUIRED/);
  await assert.rejects(() => rpc('wp_join_room_v25', [created.room_code, true, created.wake_at, 600]), /WP_CONDITIONS_CHANGED/);
  await db.exec('reset role');
  await assert.rejects(() => db.query("update public.rooms set wake_time = '12:00' where id = $1", [created.id]), /WP_CONDITIONS_IMMUTABLE/);
});

test('failed start rolls back the last participant and all generated checks', async () => {
  await identity(ids[0]); const created = await create(500, '23:59');
  await db.exec('reset role');
  await db.exec(`create function public.test_fail_check() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_FAILURE'; end; $$;
    create trigger test_fail_check before insert on public.wake_checks for each row execute function public.test_fail_check();`);
  await identity(ids[1]); await assert.rejects(() => join(created), /SIMULATED_FAILURE/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from public.room_members where room_id=$1', [created.id])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from public.wake_checks where room_id=$1', [created.id])).rows[0].n, 0);
  await db.exec('drop trigger test_fail_check on public.wake_checks; drop function public.test_fail_check()');
  await identity(ids[1]); assert.equal((await join(created)).room.status, 'active');
});

test('waiting schedule is private and start stays internal', async () => {
  await identity(ids[2]);
  await assert.rejects(() => rpc('wp_waiting_room', [room.room_code]), /WP_NOT_MEMBER/);
  await assert.rejects(() => rpc('wp_start_room', [room.id]), /permission denied/);
  await assert.rejects(() => db.query('select * from public.wake_checks'), /permission denied/);
  await assert.rejects(() => rpc('wp_join_room', [room.room_code]), /permission denied/);
  await identity(null, 'anon');
  await assert.rejects(() => rpc('wp_waiting_room', [room.room_code]), /permission denied/);
});

test('reapplying migrations is idempotent and preserves active checks', async () => {
  await db.exec('reset role');
  const before = (await db.query('select count(*)::int n from public.wake_checks')).rows[0].n;
  await db.exec(phase3); await db.exec(anyTime); await db.exec(anyTime);
  assert.equal((await db.query('select count(*)::int n from public.wake_checks')).rows[0].n, before);
  await identity(ids[0]); assert.equal((await rpc('wp_waiting_room', [room.room_code])).room.status, 'active');
});