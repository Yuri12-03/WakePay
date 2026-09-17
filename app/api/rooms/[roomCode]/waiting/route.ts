import { roomCode, route, rpc, session } from '../../../../../lib/server-api';
import type { WaitingRoom } from '../../../../../lib/types';

export async function GET(request: Request, context: { params: Promise<{ roomCode: string }> }) {
  return route(async () => {
    const auth = await session();
    return rpc<WaitingRoom>('wp_waiting_room', { p_room_code: roomCode((await context.params).roomCode) }, auth.token);
  })(request);
}
