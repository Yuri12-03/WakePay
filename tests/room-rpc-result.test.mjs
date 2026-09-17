import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomRpcResult } from '../lib/room-rpc-result.ts';

const room = { id: 'room-id', room_code: 'EA30CE', group_name: 'test', max_members: 4,
  creator_id: 'user-id', wake_time: '10:35:00', wake_at: '2026-09-19T01:35:00+00:00',
  challenge_amount: 100, status: 'waiting' };

test('production RPC envelope produces a single room envelope and correct navigation code', () => {
  const result = roomRpcResult({ room });
  assert.deepEqual(result, { room });
  assert.equal(`/room/${result.room.room_code}`, '/room/EA30CE');
});

test('repository SQL direct row retains the same API contract', () => {
  assert.deepEqual(roomRpcResult(room), { room });
});

test('invalid RPC responses fail instead of navigating to undefined or suggesting another creation', () => {
  for (const value of [null, {}, [], { room: null }, { room: [room] },
    { room: { ...room, room_code: undefined } }, { ...room, room_code: 'undefined' },
    { ...room, id: '' }]) {
    assert.throws(() => roomRpcResult(value), /ホームの参加中の部屋/);
  }
});
