import { ApiError, body, route, rpc, session, textInput } from '../../../lib/server-api';
import type { Room } from '../../../lib/types';
import { creationConditions } from '../../../lib/room-conditions';
import { roomRpcResult } from '../../../lib/room-rpc-result';

export const POST = route(async (request) => {
  const auth = await session();
  const input = await body(request);
  const group = textInput(input.group_name, 40, 'グループ名');
  if (!Number.isInteger(input.max_members) || Number(input.max_members) < 2 || Number(input.max_members) > 8) throw new ApiError(400, '参加予定人数は2〜8人にしてください。');
  let conditions: ReturnType<typeof creationConditions>;
  try { conditions = creationConditions(input); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '条件を確認してください。'); }
  const result = await rpc<unknown>('wp_create_room_v25', {
    p_group_name: group, p_max_members: input.max_members,
    p_wake_date: conditions.wake_date, p_wake_time: conditions.wake_time,
    p_challenge_amount: conditions.challenge_amount,
  }, auth.token);
  try { return roomRpcResult(result); }
  catch (error) { throw new ApiError(502, (error as Error).message); }
}, 201);

export const GET = route(async () => {
  const auth = await session();
  return { rooms: await rpc<Room[]>('wp_my_rooms', {}, auth.token) };
});
