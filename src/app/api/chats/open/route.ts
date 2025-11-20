import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { getFriendshipRecord } from '@/lib/social/friends';
import { openFriendChatRoom, openGameChat, openLobbyChat } from '@/lib/social/chats';

export const dynamic = 'force-dynamic';

const normalizeContext = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.toLowerCase();
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const context = normalizeContext(body.context);

    if (!context) {
      throw new ApiError(400, 'Missing context', { code: 'invalid_request' });
    }

    if (context === 'friend') {
      if (user.isGuest) {
        throw new ApiError(403, 'Sign in to chat with friends', { code: 'guest_not_allowed' });
      }
      const targetUserId = typeof body.userId === 'string' ? body.userId : '';
      if (!targetUserId) {
        throw new ApiError(400, 'Missing userId', { code: 'invalid_request' });
      }
      const friendship = await getFriendshipRecord(user.uid, targetUserId);
      if (!friendship) {
        throw new ApiError(404, 'You are not friends with this player', { code: 'not_friend' });
      }
      const chat = await openFriendChatRoom(friendship.id, friendship.userIds, user.uid);
      return NextResponse.json({ chat });
    }

    if (context === 'lobby') {
      const lobbyId = typeof body.lobbyId === 'string' ? body.lobbyId : '';
      if (!lobbyId) {
        throw new ApiError(400, 'Missing lobbyId', { code: 'invalid_request' });
      }
      const chat = await openLobbyChat(lobbyId, user.uid);
      return NextResponse.json({ chat });
    }

    if (context === 'game') {
      const gameId = typeof body.gameId === 'string' ? body.gameId : '';
      if (!gameId) {
        throw new ApiError(400, 'Missing gameId', { code: 'invalid_request' });
      }
      const chat = await openGameChat(gameId, user.uid);
      return NextResponse.json({ chat });
    }

    throw new ApiError(400, 'Unsupported context', { code: 'invalid_context' });
  } catch (error) {
    return handleApiError(error);
  }
}
