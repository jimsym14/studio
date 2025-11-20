import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { respondToFriendRequest } from '@/lib/social/friends';

const allowedActions = new Set(['accept', 'decline', 'cancel']);

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);

    if (user.isGuest) {
      throw new ApiError(403, 'Guests cannot manage friend requests', { code: 'guest_not_allowed' });
    }

    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action.toLowerCase() : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';

    if (!requestId) {
      throw new ApiError(400, 'Missing requestId', { code: 'invalid_request' });
    }
    if (!allowedActions.has(action)) {
      throw new ApiError(400, 'Invalid action', { code: 'invalid_action' });
    }

    const result = await respondToFriendRequest(requestId, action as 'accept' | 'decline' | 'cancel', user.uid);

    return NextResponse.json({ request: result });
  } catch (error) {
    return handleApiError(error);
  }
}
