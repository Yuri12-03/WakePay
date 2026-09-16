import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3100';
const artifacts = new URL('./artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [];
let room = null;
const members = [];
let userCount = 0;

// UI uses explicit mocks; the SQL tests independently execute real PostgreSQL.
async function client() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let user = null;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const input = method === 'POST' ? request.postDataJSON() : null;
    const reply = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/users' && method === 'POST') {
      user = { id: `user-${++userCount}`, nickname: input.nickname, icon: input.icon, created_at: new Date().toISOString() };
      return reply({ user }, 201);
    }
    if (!user) return reply({ error: { message: 'まずは利用登録をしてください。' } }, 401);
    if (path === '/api/users') return reply({ user });
    if (path === '/api/rooms' && method === 'POST') {
      assert.equal(input.max_members, 2);
      room = { id: 'room-1', room_code: 'ABC123', group_name: input.group_name, max_members: input.max_members, creator_id: user.id, status: 'waiting' };
      members.push({ id: 'member-1', user_id: user.id, approved: false, user });
      return reply({ room }, 201);
    }
    if (path === '/api/rooms') return reply({ rooms: members.some(m => m.user_id === user.id) ? [room] : [] });
    if (path.endsWith('/join')) {
      if (path !== '/api/rooms/ABC123/join') return reply({ error: { message: 'その部屋コードは見つかりませんでした。' } }, 404);
      if (!members.some(m => m.user_id === user.id)) {
        if (members.length >= room.max_members) return reply({ error: { message: 'この部屋は満員です。' } }, 409);
        members.push({ id: `member-${members.length + 1}`, user_id: user.id, approved: false, user });
      }
      return reply({ room });
    }
    if (path === '/api/rooms/ABC123') return reply({ room, members });
    return reply({ error: { message: '部屋が見つかりません。' } }, 404);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { page, context };
}
async function screenshot(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow: ${name}`);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, artifacts)), fullPage: true });
}
async function register(page, nickname) {
  await page.goto(`${baseURL}/register`);
  await page.getByLabel('ニックネーム').fill(nickname);
  await page.getByRole('radio', { name: 'いぬ', exact: true }).check();
  await screenshot(page, `register-${nickname}`);
  await page.getByRole('button', { name: '登録してはじめる' }).click();
  await page.waitForURL('**/home');
  await page.getByRole('link', { name: /WakePayを作成する/ }).waitFor();
}
try {
  // Real API guards, without any database writes.
  assert.equal((await fetch(`${baseURL}/api/rooms`)).status, 401);
  assert.equal((await fetch(`${baseURL}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: '', icon: 'cat' }) })).status, 400);
  assert.equal((await fetch(`${baseURL}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}' })).status, 403);
  const owner = await client();
  await owner.page.goto(baseURL);
  await owner.page.getByRole('link', { name: '利用を開始する' }).waitFor();
  await screenshot(owner.page, 'welcome');
  await register(owner.page, 'あさひ');
  await screenshot(owner.page, 'home');
  await owner.page.getByRole('link', { name: /WakePayを作成する/ }).click();
  await owner.page.getByLabel('グループ名').fill('1限ぜったい間に合う会');
  await owner.page.getByLabel('参加予定人数').selectOption('2');
  await screenshot(owner.page, 'create');
  await owner.page.getByRole('button', { name: '部屋を作成する' }).click();
  await owner.page.waitForURL('**/room/ABC123');
  await owner.page.getByText('1 / 2人').waitFor();
  await screenshot(owner.page, 'room-waiting');

  const guest = await client();
  await register(guest.page, 'ひなた');
  await guest.page.getByRole('link', { name: /部屋コードで参加する/ }).click();
  await guest.page.getByLabel('部屋コード', { exact: true }).fill('ZZZZZZ');
  await guest.page.getByRole('button', { name: 'この部屋に参加する' }).click();
  await guest.page.getByRole('alert').getByText('その部屋コードは見つかりませんでした。').waitFor();
  await guest.page.getByLabel('部屋コード', { exact: true }).fill('abc123');
  await screenshot(guest.page, 'join');
  await guest.page.getByRole('button', { name: 'この部屋に参加する' }).click();
  await guest.page.waitForURL('**/room/ABC123');
  await guest.page.getByText('全員そろいました！').waitFor();
  await owner.page.getByText('2 / 2人').waitFor({ timeout: 12000 });
  assert.equal(await owner.page.getByRole('button', { name: 'WakePayの設定（準備中）' }).isDisabled(), true);
  assert.equal(await guest.page.getByRole('button', { name: 'WakePayの設定（準備中）' }).count(), 0);
  await screenshot(owner.page, 'room-full');
  await guest.page.reload();
  await guest.page.getByText('2 / 2人').waitFor();
  await guest.page.getByRole('link', { name: 'ホームへ' }).click();
  await guest.page.getByRole('link', { name: /1限ぜったい間に合う会/ }).waitFor();

  const extra = await client();
  await register(extra.page, 'そら');
  await extra.page.goto(`${baseURL}/join-room`);
  await extra.page.getByLabel('部屋コード', { exact: true }).fill('ABC123');
  await extra.page.getByRole('button', { name: 'この部屋に参加する' }).click();
  await extra.page.getByRole('alert').getByText('この部屋は満員です。').waitFor();
  await screenshot(extra.page, 'join-full-error');
  assert.deepEqual(errors, []);
  console.log('PASS: API guards; mobile registration/create/join; invalid and full rooms; polling; reload; membership visibility; no overflow or page errors. Screenshots: tests/artifacts');
} finally { await browser.close(); }
