import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creationConditions, expectedConditions, japanDate, formatWakeAt } from '../lib/room-conditions.ts';
const now = new Date('2026-09-16T19:00:00Z'); // 09/17 04:00 in Japan
const input = { wake_date: '2026-09-18', wake_time: '04:00', challenge_amount: 100 };

test('Japanese dates ignore machine timezone and limits are inclusive', () => {
  assert.equal(japanDate(now), '2026-09-17');
  assert.equal(creationConditions(input, now).wake_at, '2026-09-17T19:00:00.000Z');
  assert.equal(creationConditions({ ...input, wake_time: '11:00', challenge_amount: 2000 }, now).wake_at, '2026-09-18T02:00:00.000Z');
  for (const time of ['00:00', '03:59', '11:01', '23:59']) assert.equal(creationConditions({ ...input, wake_time: time }, now).wake_time, time);
  assert.match(formatWakeAt('2026-09-17T19:00:00Z'), /2026年9月18日.*04:00/);
});
test('API validation rejects invalid numeric and calendar input before RPC calls', () => {
  for (const amount of [null, '', '100', 99, 2001, 100.5, NaN, Infinity]) assert.throws(() => creationConditions({ ...input, challenge_amount: amount }, now));
  for (const time of ['', '3:59', '07:00:01', '07:00:00', '04:60', '24:00']) assert.throws(() => creationConditions({ ...input, wake_time: time }, now));
  for (const date of ['', '2026-02-29', '2026-09-31', '0000-01-01', '2026-9-18', '2026-09-16']) assert.throws(() => creationConditions({ ...input, wake_date: date }, now));
  assert.throws(() => creationConditions({ ...input, wake_date: '2026-09-17' }, now));
  assert.equal(creationConditions({ ...input, wake_date: '2026-09-17', wake_time: '04:01' }, now).wake_time, '04:01');
  assert.equal(creationConditions({ ...input, wake_date: '2028-02-29' }, now).wake_date, '2028-02-29');
});
test('join requires explicit consent, valid snapshot, and a timezone', () => {
  const accepted = { accepted: true, expected_conditions: { wake_at: '2026-09-18T04:00:00+09:00', challenge_amount: 100 } };
  assert.equal(expectedConditions(accepted).wake_at, '2026-09-17T19:00:00.000Z');
  for (const value of [{}, { ...accepted, accepted: false }, { ...accepted, accepted: 'true' }, { ...accepted, expected_conditions: [] }]) assert.throws(() => expectedConditions(value));
  for (const stamp of ['2026-09-18T04:00:00', 'bad', '2026-02-29T04:00:00Z']) assert.throws(() => expectedConditions({ ...accepted, expected_conditions: { ...accepted.expected_conditions, wake_at: stamp } }));
});
