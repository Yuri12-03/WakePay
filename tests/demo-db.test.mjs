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
const demo = await readFile(new URL('../supabase/demo-results.sql', import.meta.url), 'utf8');
const snapshot = () => rpc('wp_demo_room', [room.room_code]);
const answer = (round, success) => rpc('wp_demo_submit', [room.room_code, round, success]);
const reset = round => rpc('wp_demo_reset', [room.room_code, round]);
let checksBefore;

test('demo starts with no answers and does not write on read', async () => {
  await db.exec('reset role'); await db.exec(phase3); await db.exec(demo);
  await identity(ids[0]); room = await create(101, '07:00', 3);
  await assert.rejects(() => snapshot(), /WP_DEMO_NOT_STARTED/);
  await identity(ids[1]); await join(room);
  await identity(ids[2]); await join(room);
  await identity(ids[0]);
  const data = await snapshot();
  assert.equal(data.round, 1); assert.equal(data.complete, false); assert.equal(data.can_reset, true);
  assert.ok(data.members.every(m => m.success === null && m.delta === null));
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from public.wp_demo_rounds')).rows[0].n, 0);
  checksBefore = (await db.query('select * from public.wake_checks order by id')).rows;
});

test('one answer per member, no premature payout, exact remainder allocation', async () => {
  await identity(ids[0]);
  const first = await answer(1, true);
  assert.equal(first.answered, 1); assert.equal(first.complete, false);
  assert.ok(first.members.every(m => m.delta === null));
  assert.equal((await answer(1, true)).answered, 1);
  await assert.rejects(() => answer(1, false), /WP_DEMO_ALREADY_ANSWERED/);
  await identity(ids[1]); await answer(1, true);
  await identity(ids[2]); const last = await answer(1, false);
  assert.equal(last.complete, true); assert.equal(last.pool, 101);
  assert.deepEqual(last.members.map(m => m.delta), [51, 50, -101]);
  assert.equal(last.members.reduce((s, m) => s + m.delta, 0), 0);
  assert.equal(last.can_reset, false);
});

test('only owner resets; stale answers and repeated old resets cannot affect next round', async () => {
  await identity(ids[1]); await assert.rejects(() => reset(1), /WP_DEMO_OWNER_ONLY/);
  await identity(ids[0]);
  const next = await reset(1); assert.equal(next.round, 2); assert.equal(next.answered, 0);
  await assert.rejects(() => answer(1, false), /WP_DEMO_STALE/);
  await assert.rejects(() => reset(1), /WP_DEMO_STALE/);
  assert.equal((await snapshot()).round, 2);
});

test('all success means zero; all failure means everyone loses their stake', async () => {
  for (const id of ids) { await identity(id); await answer(2, true); }
  assert.ok((await snapshot()).members.every(m => m.delta === 0));
  await identity(ids[0]); await reset(2);
  for (const id of ids) { await identity(id); await answer(3, false); }
  const result = await snapshot();
  assert.equal(result.success_count, 0); assert.equal(result.pool, 303);
  assert.ok(result.members.every(m => m.delta === -101));
});

test('reset can restart a partial round without touching real checks or room status', async () => {
  await identity(ids[0]); await reset(3); await answer(4, false); await reset(4);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.wake_checks order by id')).rows, checksBefore);
  assert.equal((await db.query('select status from public.rooms where id=$1', [room.id])).rows[0].status, 'active');
});

test('nonmembers, anonymous users, direct table access and invalid input are rejected', async () => {
  await identity('44444444-4444-4444-8444-444444444444'); await rpc('wp_register', ['外部', 'dog']);
  await assert.rejects(() => snapshot(), /WP_NOT_MEMBER/);
  await assert.rejects(() => answer(5, true), /WP_NOT_MEMBER/);
  await assert.rejects(() => reset(5), /WP_NOT_MEMBER/);
  await identity(ids[0]);
  await assert.rejects(() => answer(null, true), /WP_INVALID_INPUT/);
  await assert.rejects(() => answer(5, null), /WP_INVALID_INPUT/);
  await assert.rejects(() => db.query('select * from public.wp_demo_answers'), /permission denied/);
  await assert.rejects(() => db.query('delete from public.wp_demo_answers'), /permission denied/);
  await identity(null, 'anon'); await assert.rejects(() => snapshot(), /permission denied/);
});

test('migration rerun preserves answers and round', async () => {
  await identity(ids[0]); await answer(5, true);
  await db.exec('reset role'); await db.exec(demo);
  await identity(ids[0]); const data = await snapshot();
  assert.equal(data.round, 5); assert.equal(data.answered, 1);
});