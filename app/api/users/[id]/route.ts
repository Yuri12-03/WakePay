import { ApiError, route, rpc, session } from '../../../../lib/server-api';
import type { User } from '../../../../lib/types';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const auth = await session();
    const { id } = await context.params;
    if (id !== auth.userId) throw new ApiError(403, '自分のユーザー情報のみ取得できます。');
    return { user: await rpc<User>('wp_current_user', {}, auth.token) };
  })(request);
}
