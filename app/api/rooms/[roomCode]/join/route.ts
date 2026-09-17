import { ApiError, body, roomCode, route, rpc, session } from '../../../../../lib/server-api';
import { roomRpcResult } from '../../../../../lib/room-rpc-result';
import { expectedConditions } from '../../../../../lib/room-conditions';

export async function POST(request: Request, context: { params: Promise<{ roomCode: string }> }) {
  return route(async () => {
    const auth = await session();
    const code = roomCode((await context.params).roomCode);
    const input = await body(request);
    let expected: ReturnType<typeof expectedConditions>;
    try { expected = expectedConditions(input); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '条件を確認してください。'); }
    const result = await rpc<unknown>('wp_join_room_v25', {
      p_room_code: code, p_accepted: true,
      p_expected_wake_at: expected.wake_at, p_expected_challenge_amount: expected.challenge_amount,
    }, auth.token);
    try { return roomRpcResult(result); }
    catch (error) { throw new ApiError(502, (error as Error).message); }
  })(request);
}
