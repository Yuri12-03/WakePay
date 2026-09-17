import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3200';
const artifacts = new URL('./artifacts/phase25/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [];
const futureDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const wakeAt = `${futureDate}T07:00:00+09:00`;
const rooms = new Map();
let userCount = 0, creates = 0, joins = 0, lookupCount = 0;
rooms.set('OLD123', { room_code: 'OLD123', group_name: '旧部屋', wake_at: null, wake_time: null, challenge_amount: null, max_members: 4, members: [], status: 'waiting' });
rooms.set('EXP123', { room_code: 'EXP123', group_name: '期限切れの部屋', wake_at: '2020-01-01T07:00:00+09:00', challenge_amount: 500, max_members: 4, members: [], status: 'waiting' });
rooms.set('SLOW12', { room_code: 'SLOW12', group_name: '古い検索結果', wake_at: wakeAt, challenge_amount: 500, max_members: 4, members: [], status: 'waiting' });
rooms.set('RACE12', { room_code: 'RACE12', group_name: '確認後に満員', wake_at: wakeAt, challenge_amount: 500, max_members: 2, members: [], status: 'waiting' });

// Explicit UI fixtures: never write to the shared Supabase project.
async function client() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  let user = null;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const input = method === 'POST' ? request.postDataJSON() : null;
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (path === '/api/users' && method === 'POST') {
      user = { id: `user-${++userCount}`, nickname: input.nickname, icon: input.icon, created_at: new Date().toISOString() };
      return reply({ user }, 201);
    }
    if (!user) return reply({ error: { message: 'まずは利用登録をしてください。' } }, 401);
    if (path === '/api/users') return reply({ user });
    if (path === '/api/rooms' && method === 'POST') {
      creates++;
      assert.equal(input.wake_date, futureDate); assert.equal(input.wake_time, '07:00'); assert.equal(input.challenge_amount, 500);
      const room = { id: 'room-1', room_code: 'ABC123', group_name: input.group_name, max_members: input.max_members, creator_id: user.id, status: 'waiting', wake_time: '07:00:00', wake_at: wakeAt, challenge_amount: 500, members: [{ id: 'member-1', user_id: user.id, approved: true, user }] };
      rooms.set('ABC123', room);
      return reply({ room }, 201);
    }
    if (path === '/api/rooms') return reply({ rooms: [...rooms.values()].filter(r => r.members.some(m => m.user_id === user.id)) });
    const code = path.split('/')[3];
    const room = rooms.get(code);
    if (!room) return reply({ error: { message: 'その部屋コードは見つかりませんでした。' } }, 404);
    if (path.endsWith('/preview')) {
      lookupCount++;
      if (code === 'SLOW12') await new Promise(resolve => setTimeout(resolve, 1200));
      const reason = !room.wake_at ? 'conditions_missing' : Date.parse(room.wake_at) <= Date.now() ? 'expired' : room.status !== 'waiting' ? 'closed' : room.members.length >= room.max_members ? 'full' : null;
      const isMember = room.members.some(m => m.user_id === user.id);
      return reply({ room: { room_code: code, group_name: room.group_name, max_members: room.max_members, member_count: room.members.length, wake_at: room.wake_at, challenge_amount: room.challenge_amount, status: room.status }, is_member: isMember, can_join: !isMember && !reason, unavailable_reason: reason });
    }
    if (path.endsWith('/join')) {
      joins++;
      assert.equal(input.accepted, true);
      assert.equal(Date.parse(input.expected_conditions.wake_at), Date.parse(room.wake_at));
      assert.equal(input.expected_conditions.challenge_amount, room.challenge_amount);
      if (code === 'RACE12') return reply({ error: { message: 'この部屋は満員です。' } }, 409);
      if (!room.members.some(m => m.user_id === user.id)) {
        if (room.status !== 'waiting' || room.members.length >= room.max_members) return reply({ error: { message: 'この部屋は満員です。' } }, 409);
        room.members.push({ id: `member-${room.members.length + 1}`, user_id: user.id, approved: true, user });
        if (room.members.length === room.max_members) room.status = 'ready';
      }
      return reply({ room });
    }
    return reply({ room, members: room.members });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { page, context };
}
async function screenshot(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow: ${name}`);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, artifacts)), fullPage: true });
}
async function register(page, name) {
  await page.goto(`${baseURL}/register`);
  await page.getByLabel('ニックネーム').fill(name);
  await page.getByRole('button', { name: '登録してはじめる' }).click();
  await page.waitForURL('**/home');
  await page.getByRole('link', { name: /WakePayを作成する/ }).waitFor();
}
async function preview(page, code) {
  await page.getByLabel('部屋コード', { exact: true }).fill(code);
  await page.getByRole('button', { name: '部屋の条件を確認する' }).click();
  await page.getByRole('region', { name: '参加前の条件確認' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '部屋の条件を確認する' }).count(), 0);
  assert.equal(await page.getByLabel('部屋コード', { exact: true }).count(), 0);
}

try {
  assert.equal((await fetch(`${baseURL}/api/rooms/ABC123/preview`)).status, 401);
  const owner = await client();
  await register(owner.page, 'あさひ');
  await owner.page.getByRole('link', { name: /WakePayを作成する/ }).click();
  await owner.page.getByLabel('グループ名').fill('1限ぜったい間に合う会');
  await owner.page.getByLabel('参加予定人数').selectOption('2');
  for (const label of ['起床日', '起床時刻', 'チャレンジ金額']) assert.equal(await owner.page.getByLabel(label, { exact: false }).inputValue(), '');
  await owner.page.getByLabel('起床日', { exact: false }).fill(futureDate);
  await owner.page.getByLabel('起床時刻').fill('07:00');
  await owner.page.getByLabel('チャレンジ金額').fill('99');
  await owner.page.getByRole('button', { name: 'この条件で部屋を作成して参加する' }).click();
  assert.equal(creates, 0);
  assert.equal(await owner.page.getByLabel('チャレンジ金額').evaluate(e => e.validity.rangeUnderflow), true);
  await owner.page.getByLabel('チャレンジ金額').fill('500');
  await owner.page.getByLabel('起床時刻').fill('11:01');
  assert.equal(await owner.page.getByLabel('起床時刻').evaluate(e => e.validity.valid), true);
  assert.equal(creates, 0);
  await owner.page.getByLabel('起床時刻').fill('07:00');
  await screenshot(owner.page, 'create-conditions');
  await owner.page.getByRole('button', { name: 'この条件で部屋を作成して参加する' }).click();
  await owner.page.waitForURL('**/room/ABC123');
  await owner.page.getByText('1 / 2人').waitFor();
  await owner.page.getByText(/07:00/).waitFor();
  await screenshot(owner.page, 'room-waiting');

  const guest = await client();
  await register(guest.page, 'ひなた');
  await guest.page.getByRole('link', { name: /部屋コードで参加する/ }).click();
  await preview(guest.page, 'abc123');
  assert.equal(joins, 0); assert.equal(rooms.get('ABC123').members.length, 1);
  assert.equal(await guest.page.getByText('あさひ', { exact: true }).count(), 0);
  await guest.page.getByText(/07:00/).waitFor();
  await screenshot(guest.page, 'preview-conditions');
  await guest.page.getByRole('button', { name: '参加しない', exact: true }).click();
  assert.equal(await guest.page.getByRole('region', { name: '参加前の条件確認' }).count(), 0);
  await guest.page.getByRole('button', { name: '部屋の条件を確認する' }).waitFor();
  assert.equal(joins, 0); assert.equal(rooms.get('ABC123').members.length, 1);
  await preview(guest.page, 'ABC123');
  await guest.page.getByRole('button', { name: 'この条件で参加する' }).click();
  await guest.page.waitForURL('**/room/ABC123');
  await guest.page.getByText('全員そろいました！').waitFor();
  await owner.page.getByText('全員そろいました！').waitFor({ timeout: 12000 });
  assert.equal(joins, 1);
  assert.equal(await owner.page.getByRole('button', { name: /設定|開始|変更/ }).count(), 0);
  await screenshot(owner.page, 'room-ready');
  await guest.page.reload(); await guest.page.getByText('2 / 2人').waitFor();
  await guest.page.goto(`${baseURL}/join-room`); await preview(guest.page, 'ABC123');
  await guest.page.getByRole('link', { name: '部屋へ進む' }).waitFor();
  assert.equal(await guest.page.getByRole('button', { name: 'この条件で参加する' }).count(), 0);

  const extra = await client(); await register(extra.page, 'そら');
  await extra.page.goto(`${baseURL}/join-room`);
  for (const code of ['OLD123', 'EXP123', 'ABC123']) {
    await preview(extra.page, code);
    assert.equal(await extra.page.getByRole('button', { name: 'この条件で参加する' }).isDisabled(), true);
    await screenshot(extra.page, `unavailable-${code}`);
    await extra.page.getByRole('button', { name: '参加しない', exact: true }).click();
  }
  await extra.page.getByLabel('部屋コード', { exact: true }).fill('ZZZZZZ');
  await extra.page.getByRole('button', { name: '部屋の条件を確認する' }).click();
  await extra.page.getByRole('alert').getByText('その部屋コードは見つかりませんでした。').waitFor();
  await preview(extra.page, 'RACE12');
  await extra.page.getByRole('button', { name: 'この条件で参加する' }).click();
  await extra.page.getByRole('alert').getByText('この部屋は満員です。').waitFor();
  assert.equal(await extra.page.getByRole('region', { name: '参加前の条件確認' }).count(), 0);

  // Changing the code during a slow lookup must discard the stale response.
  await extra.page.getByLabel('部屋コード', { exact: true }).fill('SLOW12');
  const slowRequest = extra.page.waitForRequest('**/SLOW12/preview');
  await extra.page.getByRole('button', { name: '部屋の条件を確認する' }).click();
  await slowRequest;
  await preview(extra.page, 'EXP123');
  await extra.page.waitForTimeout(1500);
  assert.equal(await extra.page.getByRole('heading', { name: '古い検索結果' }).count(), 0);
  await extra.page.getByRole('heading', { name: '期限切れの部屋' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: Phase 2.5 mobile UI, empty defaults, limits, Japanese timezone, preview/decline without writes, explicit consent, ready/polling/reload, legacy/expiry/full, existing member, race, stale preview. ${lookupCount} lookups; ${joins} join attempts.`);
} finally { await browser.close(); }
