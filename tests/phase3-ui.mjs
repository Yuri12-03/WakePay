import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3210';
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
const errors = [];
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const user = { id: 'u1', nickname: 'あさひ', icon: 'cat' };
const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const room = { id: 'r1', room_code: 'ABC123', group_name: '夜のテスト部屋', max_members: 2, creator_id: 'u1', wake_at: `${date}T23:59:00+09:00`, wake_time: '23:59:00', challenge_amount: 500, status: 'waiting' };
const members = [{ id: 'm1', user_id: 'u1', user, approved: true }];
let waitingError = 0;
let serverNow = Date.parse(room.wake_at) - 60000;
let creation;
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  const reply = (json, status = 200) => route.fulfill({ status, json });
  if (path === '/api/users') return reply({ user });
  if (path === '/api/rooms' && request.method() === 'POST') { creation = request.postDataJSON(); return reply({ room }, 201); }
  if (path === '/api/rooms') return reply({ rooms: [room] });
  if (path.endsWith('/demo')) return reply({ round: 1, user_id: user.id, can_reset: true, complete: false, answered: 0, total: 2, amount: 500, pool: null, success_count: 0, members: [{ user_id: user.id, nickname: user.nickname, icon: user.icon, success: null, delta: null }] });
  if (path.endsWith('/waiting')) {
    if (waitingError) return reply({ error: { message: '部屋の参加者のみ閲覧できます。' } }, waitingError);
    return reply({ room, server_now: new Date(serverNow).toISOString(), checks: [1,2,3].map(n => ({ check_number: n, opens_at: new Date(Date.parse(room.wake_at) + (n-1)*600000).toISOString(), deadline: new Date(Date.parse(room.wake_at) + n*600000).toISOString() })) });
  }
  return reply({ room, members });
});
try {
  await page.goto(`${baseURL}/create-room`);
  await page.locator('#group').fill('深夜も使える部屋');
  await page.locator('#count').selectOption('2');
  await page.locator('#wake-date').fill(date);
  await page.locator('#wake-time').fill('23:59');
  await page.locator('#amount').fill('500');
  assert.equal(await page.locator('#wake-time').getAttribute('min'), null);
  assert.equal(await page.locator('#wake-time').getAttribute('max'), null);
  await page.getByRole('button', { name: 'この条件で部屋を作成して参加する' }).click();
  await page.waitForURL('**/room/ABC123');
  assert.equal(creation.wake_time, '23:59');
  room.status = 'active';
  await page.waitForURL('**/room/ABC123/waiting', { timeout: 12000 });
  await page.getByRole('heading', { name: 'あなたの起床確認の予定' }).waitFor();
  assert.equal(await page.locator('.wp-schedule li').count(), 3);
  assert.match(await page.locator('.wp-conditions').innerText(), /23:59/);
  assert.match(await page.locator('.wp-schedule').innerText(), /00:29/);
  assert.match(await page.locator('.wp-countdown').innerText(), /0日 0時間 [01]分/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(new URL('./artifacts/phase3/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('./artifacts/phase3/waiting.png', import.meta.url)), fullPage: true });
  await page.reload(); await page.getByRole('heading', { name: 'あなたの起床確認の予定' }).waitFor();
  serverNow = Date.parse(room.wake_at) + 1;
  await page.reload(); await page.getByText('設定した起床時刻になりました', { exact: true }).waitFor();
  assert.ok(page.url().endsWith('/waiting'));
  serverNow += 1800000;
  await page.reload(); await page.getByText('起床確認の予定時間が終了しました', { exact: true }).waitFor();
  waitingError = 403;
  await page.reload(); await page.locator('.wp-error[role=alert]').waitFor();
  assert.equal(await page.locator('.wp-schedule').count(), 0);
  waitingError = 0; room.status = 'waiting';
  await page.reload(); await page.waitForURL('**/room/ABC123');
  assert.deepEqual(errors, []);
  console.log('Phase 3 UI passed: unrestricted input, polling redirect, reload, JST/day rollover, server clock, expired schedule, access errors, non-active redirect, 390px layout.');
} finally { await browser.close(); }