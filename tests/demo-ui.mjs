import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.TEST_BASE_URL || 'http://localhost:3211';
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
const users = ['あさひ', 'ひなた', 'そら'].map((nickname, n) => ({ id: `u${n}`, nickname, icon: 'cat' }));
const wake = Date.now() + 3600000;
const room = { id: 'r1', room_code: 'ABC123', group_name: 'デモ朝活チーム', max_members: 3, creator_id: 'u0', wake_at: new Date(wake).toISOString(), challenge_amount: 101, status: 'active' };
const answers = new Map();
let round = 1, errorMode = false, writes = 0;
const errors = [];
const pages = [];
function result(user) {
  const complete = answers.size === users.length;
  const winners = [...answers].filter(([, success]) => success).map(([id]) => id);
  const pool = [...answers.values()].filter(x => !x).length * 101;
  const ownDelta = !complete ? 0 : !answers.get(user.id) ? -101 : Math.floor(pool / winners.length) + (user.id === winners[0] ? pool % winners.length : 0);
  return { balance: 2000 + ownDelta, balance_applied: complete, round, user_id: user.id, can_reset: user.id === 'u0', complete, answered: answers.size, total: 3, amount: 101, pool: complete ? pool : null, success_count: winners.length,
    members: users.map(u => ({ user_id: u.id, nickname: u.nickname, icon: u.icon, success: answers.get(u.id) ?? null,
      delta: !complete ? null : !answers.get(u.id) ? -101 : Math.floor(pool / winners.length) + (u.id === winners[0] ? pool % winners.length : 0) })) };
}
try {
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
    await context.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const reply = (json, status = 200) => route.fulfill({ status, json });
      if (path.endsWith('/waiting')) return reply({ room, server_now: new Date().toISOString(), checks: [1,2,3].map(n => ({ check_number: n, opens_at: new Date(wake + (n-1)*600000).toISOString(), deadline: new Date(wake + n*600000).toISOString() })) });
      if (path.endsWith('/demo')) {
        if (errorMode) return reply({ error: { message: 'データベースの準備中です。必要な移行SQLの適用を確認してください。' } }, 503);
        if (req.method() === 'POST') {
          writes++;
          const body = req.postDataJSON();
          if (body.round !== round) return reply({ error: { message: 'デモがリセットされました。最新の画面で選び直してください。' } }, 409);
          if (body.action === 'reset') { assert.equal(user.id, 'u0'); round++; answers.clear(); }
          else { assert.equal(typeof body.success, 'boolean'); answers.set(user.id, body.success); }
        }
        return reply(result(user));
      }
      if (path === '/api/users') return reply({ user: { ...user, balance: result(user).balance } });
      if (path === '/api/rooms') return reply({ rooms: [room] });
      return reply({ room, members: [] });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/room/ABC123/waiting`);
    await page.getByRole('button', { name: '起きられた', exact: true }).waitFor();
    pages.push(page);
  }
  const [owner, guest, third] = pages;
  assert.equal(await guest.getByRole('button', { name: '結果をリセットする', exact: true }).count(), 0);
  await owner.getByRole('button', { name: '起きられた', exact: true }).click();
  await owner.getByText('あなたの回答：起きられた。', { exact: false }).waitFor();
  assert.equal(await owner.locator('.wp-demo-outcome b').first().innerText(), '分配未確定');
  await owner.reload(); await owner.getByText('あなたの回答：起きられた。', { exact: false }).waitFor();
  await guest.getByRole('button', { name: '起きられた', exact: true }).click();
  await third.getByRole('button', { name: '起きられなかった', exact: true }).click();
  for (const page of pages) {
    await page.getByRole('heading', { name: '結果とポイント分配' }).waitFor({ timeout: 10000 });
    assert.deepEqual(await page.locator('.wp-demo-outcome b').allTextContents(), ['+51 WP', '+50 WP', '-101 WP']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const home = await owner.context().newPage(); await home.goto(base + '/home');
  await home.getByText('2,051 WP', { exact: true }).waitFor();
  await mkdir(new URL('./artifacts/demo/', import.meta.url), { recursive: true });
  await owner.screenshot({ path: fileURLToPath(new URL('./artifacts/demo/results.png', import.meta.url)), fullPage: true });
  await owner.getByRole('button', { name: '結果をリセットする', exact: true }).click();
  await owner.getByRole('button', { name: 'やめる', exact: true }).click(); assert.equal(round, 1);
  await owner.getByRole('button', { name: '結果をリセットする', exact: true }).click();
  await owner.getByRole('button', { name: '全員の結果をリセットする', exact: true }).click();
  for (const page of pages) { await page.getByRole('button', { name: '起きられた', exact: true }).waitFor({ timeout: 10000 }); }
  assert.equal(round, 2); assert.equal(answers.size, 0);
  await home.getByText('2,000 WP', { exact: true }).waitFor({ timeout: 10000 });
  for (const page of pages) await page.getByRole('button', { name: '起きられなかった', exact: true }).click();
  await owner.getByText('全員失敗のため、全員が設定ポイントを失い、分配はありません。', { exact: true }).waitFor({ timeout: 10000 });
  assert.deepEqual(await owner.locator('.wp-demo-outcome b').allTextContents(), ['-101 WP', '-101 WP', '-101 WP']);
  errorMode = true; await owner.reload(); await owner.locator('.wp-demo .wp-error').waitFor();
  errorMode = false; await owner.getByRole('button', { name: 'デモを再読み込み' }).click();
  await owner.getByRole('heading', { name: '結果とポイント分配' }).waitFor();
  assert.deepEqual(errors, []); assert.equal(writes, 7);
  console.log('PASS: 3 separate browsers, 390px, shared results/payout, reload, reset/cancel, all fail, missing migration recovery.');
} finally { await browser.close(); }