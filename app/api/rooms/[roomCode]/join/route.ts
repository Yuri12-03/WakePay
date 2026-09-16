import { roomCode, route, rpc, session } from '../../../../../lib/server-api';
import type { Room } from '../../../../../lib/types';

export async function POST(request: Request, context: { params: Promise<{ roomCode: string }> }) {
  return route(async () => {
    const auth = await session();
    const code = roomCode((await context.params).roomCode);
    return { room: await rpc<Room>('wp_join_room', { p_room_code: code }, auth.token) };
  })(request);
}
