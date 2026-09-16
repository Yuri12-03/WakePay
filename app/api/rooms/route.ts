import { ApiError, body, route, rpc, session, textInput } from '../../../lib/server-api';
import type { Room } from '../../../lib/types';

export const POST = route(async (request) => {
  const auth = await session();
  const input = await body(request);
  const group = textInput(input.group_name, 40, 'グループ名');
  if (!Number.isInteger(input.max_members) || Number(input.max_members) < 2 || Number(input.max_members) > 8) throw new ApiError(400, '参加予定人数は2〜8人にしてください。');
  return { room: await rpc<Room>('wp_create_room', { p_group_name: group, p_max_members: input.max_members }, auth.token) };
}, 201);

export const GET = route(async () => {
  const auth = await session();
  return { rooms: await rpc<Room[]>('wp_my_rooms', {}, auth.token) };
});
