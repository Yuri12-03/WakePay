import { ApiError, body, roomCode, route, rpc, session } from '../../../../../lib/server-api';
import type { DemoResult } from '../../../../../lib/types';
type Context = { params: Promise<{ roomCode: string }> };

export async function GET(request: Request, context: Context) {
  return route(async () => {
    const auth = await session();
    return rpc<DemoResult>('wp_demo_room', { p_room_code: roomCode((await context.params).roomCode) }, auth.token);
  })(request);
}
export async function POST(request: Request, context: Context) {
  return route(async () => {
    const auth = await session();
    const code = roomCode((await context.params).roomCode);
    const input = await body(request);
    if (!Number.isSafeInteger(input.round) || Number(input.round) < 1 || Number(input.round) > 2147483647) throw new ApiError(400, 'デモを再読み込みしてください。');
    if (input.action === 'reset') return rpc<DemoResult>('wp_demo_reset', { p_room_code: code, p_round: input.round }, auth.token);
    if (input.action !== 'answer' || typeof input.success !== 'boolean') throw new ApiError(400, '起床結果を選んでください。');
    return rpc<DemoResult>('wp_demo_submit', { p_room_code: code, p_round: input.round, p_success: input.success }, auth.token);
  })(request);
}