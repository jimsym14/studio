import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { listFriendRequests } from '@/lib/social/friends';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);

    if (user.isGuest) {
      throw new ApiError(403, 'Guests do not have friend requests', { code: 'guest_not_allowed' });
    }

    const directionParam = request.nextUrl.searchParams.get('direction');
    const direction = directionParam === 'outgoing' ? 'outgoing' : 'incoming';

    const requests = await listFriendRequests(user.uid, direction);

    return NextResponse.json({ requests });
  } catch (error) {
    return handleApiError(error);
  }
}
