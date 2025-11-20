import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { listFriends } from '@/lib/social/friends';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);

    if (user.isGuest) {
      throw new ApiError(403, 'Guests do not have friends lists', { code: 'guest_not_allowed' });
    }

    const friends = await listFriends(user.uid);

    return NextResponse.json({ friends });
  } catch (error) {
    return handleApiError(error);
  }
}
