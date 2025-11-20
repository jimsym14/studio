import { NextRequest, NextResponse } from 'next/server';

import { MAX_FRIEND_REQUEST_MESSAGE_LENGTH } from '@/lib/social/constants';
import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { sendFriendRequest } from '@/lib/social/friends';

export const dynamic = 'force-dynamic';

const normalizeMessage = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_FRIEND_REQUEST_MESSAGE_LENGTH);
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);

    if (user.isGuest) {
      throw new ApiError(403, 'Sign in to send friend requests', { code: 'guest_not_allowed' });
    }

    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username : undefined;
    const targetUserId = typeof body.userId === 'string' ? body.userId : undefined;
    const message = normalizeMessage(body.message);

    if (!username && !targetUserId) {
      throw new ApiError(400, 'Provide a username or userId', { code: 'invalid_request' });
    }

    const requestRecord = await sendFriendRequest({
      fromUserId: user.uid,
      toUsername: username,
      toUserId: targetUserId,
      message,
    });

    return NextResponse.json({ request: requestRecord }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
