import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';

const db = new PGlite();
const migration = await readFile(new URL('../supabase/phase2.sql', import.meta.url), 'utf8');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
let room;
async function identity(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.user_id', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
}
async function rpc(name, args = []) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
  return (await db.query(`select public.${name}(${placeholders}) as data`, args)).rows[0].data;
}
before(async () => {
  // Reproduce the supplied schema. auth.uid() is stubbed only in this isolated DB.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    create table public.users(id text primary key default gen_random_uuid()::text, nickname text not null, icon text not null default 'cat', created_at timestamp default now());
    create table public.rooms(id text primary key default gen_random_uuid()::text, room_code text unique not null, group_name text not null, max_members integer not null default 4, creator_id text references public.users(id), wake_time time, challenge_amount integer, status text not null default 'waiting', created_at timestamp default now());
    create table public.room_members(id text primary key default gen_random_uuid()::text, room_id text references public.rooms(id), user_id text references public.users(id), approved boolean default false, joined_at timestamp default now());
    create table public.wake_checks(id text primary key default gen_random_uuid()::text, room_id text references public.rooms(id), user_id text references public.users(id), check_number integer not null, checked_at timestamp, deadline timestamp not null);
  `);
  await db.exec(migration);
});
after(async () => { await db.close(); });

test('anonymous clients cannot read tables or call profile RPCs', async () => {
  await identity(null, 'anon');
  await assert.rejects(() => db.query('select * from public.users'), /permission denied/);
  await assert.rejects(() => rpc('wp_current_user'), /permission denied/);
});
test('registration binds ID to Auth, validates values, and is idempotent', async () => {
  await identity(ids[0]);
  await assert.rejects(() => rpc('wp_register', [' ', 'cat']), /WP_INVALID_INPUT/);
  await assert.rejects(() => rpc('wp_register', ['あさひ', 'invalid']), /WP_INVALID_INPUT/);
  const user = await rpc('wp_register', [' あさひ ', 'cat']);
  assert.equal(user.id, ids[0]); assert.equal(user.nickname, 'あさひ');
  assert.equal((await rpc('wp_register', ['別名', 'dog'])).nickname, 'あさひ');
  await assert.rejects(() => db.query("update public.users set nickname = 'changed'"), /permission denied/);
});
test('room creation validates input and automatically includes its owner', async () => {
  await assert.rejects(() => rpc('wp_create_room', ['room', 9]), /WP_INVALID_INPUT/);
  await assert.rejects(() => rpc('wp_create_room', [' ', 4]), /WP_INVALID_INPUT/);
  room = await rpc('wp_create_room', ['朝活チーム', 2]);
  assert.match(room.room_code, /^[A-Z0-9]{6}$/);
  assert.equal(room.creator_id, ids[0]);
  const detail = await rpc('wp_get_room', [room.room_code]);
  assert.equal(detail.members.length, 1);
  assert.equal(detail.members[0].user.nickname, 'あさひ');
  assert.equal((await rpc('wp_my_rooms')).length, 1);
});
test('nonmembers cannot read participants; joining twice does not add duplicates', async () => {
  await identity(ids[1]);
  await rpc('wp_register', ['ひなた', 'dog']);
  assert.deepEqual(await rpc('wp_my_rooms'), []);
  await assert.rejects(() => rpc('wp_get_room', [room.room_code]), /WP_NOT_MEMBER/);
  await assert.rejects(() => rpc('wp_join_room', ['ZZZZZZ']), /WP_ROOM_NOT_FOUND/);
  await rpc('wp_join_room', [room.room_code.toLowerCase()]);
  await rpc('wp_join_room', [room.room_code]);
  assert.equal((await rpc('wp_get_room', [room.room_code])).members.length, 2);
  assert.equal((await rpc('wp_my_rooms')).length, 1);
});
test('full and closed rooms reject new members', async () => {
  await identity(ids[2]); await rpc('wp_register', ['そら', 'fox']);
  await assert.rejects(() => rpc('wp_join_room', [room.room_code]), /WP_ROOM_FULL/);
  await db.exec('reset role');
  await db.query("update public.rooms set status = 'active' where id = $1", [room.id]);
  await identity(ids[2]);
  await assert.rejects(() => rpc('wp_join_room', [room.room_code]), /WP_ROOM_CLOSED/);
  await identity(ids[0]);
  assert.equal((await rpc('wp_join_room', [room.room_code])).id, room.id);
});
test('room creation rolls back when owner membership fails', async () => {
  await db.exec('reset role');
  const beforeCount = (await db.query('select count(*)::int as n from public.rooms')).rows[0].n;
  await db.exec(`
    create function public.test_reject_member() returns trigger language plpgsql as $$
    begin raise exception 'SIMULATED_INSERT_FAILURE'; end; $$;
    create trigger test_reject_member before insert on public.room_members for each row execute function public.test_reject_member();
  `);
  await identity(ids[0]);
  await assert.rejects(() => rpc('wp_create_room', ['失敗する部屋', 3]), /SIMULATED_INSERT_FAILURE/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from public.rooms')).rows[0].n, beforeCount);
  await db.exec('drop trigger test_reject_member on public.room_members; drop function public.test_reject_member()');
});
test('migration can be reapplied without losing profiles or memberships', async () => {
  await db.exec('reset role'); await db.exec(migration);
  await identity(ids[0]);
  assert.equal((await rpc('wp_current_user')).nickname, 'あさひ');
  assert.equal((await rpc('wp_get_room', [room.room_code])).members.length, 2);
});
