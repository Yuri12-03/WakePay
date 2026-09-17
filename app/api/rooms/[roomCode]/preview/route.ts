import { roomCode, route, rpc, session } from '../../../../../lib/server-api';
import type { RoomPreview } from '../../../../../lib/types';

export async function GET(request: Request, context: { params: Promise<{ roomCode: string }> }) {
  return route(async () => {
    const auth = await session();
    const code = roomCode((await context.params).roomCode);
    return rpc<RoomPreview>('wp_preview_room', { p_room_code: code }, auth.token);
  })(request);
}
