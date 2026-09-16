import { body, iconInput, newSession, route, rpc, session, textInput } from '../../../lib/server-api';
import type { User } from '../../../lib/types';

export const POST = route(async (request) => {
  const input = await body(request);
  const nickname = textInput(input.nickname, 20, 'ニックネーム');
  const icon = iconInput(input.icon);
  const auth = await newSession();
  const user = await rpc<User>('wp_register', { p_nickname: nickname, p_icon: icon }, auth.token);
  return { user };
}, 201);

export const GET = route(async () => {
  const auth = await session();
  return { user: await rpc<User>('wp_current_user', {}, auth.token) };
});
