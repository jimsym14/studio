import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { listNotifications } from '@/lib/social/notifications';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    if (user.isGuest) {
      throw new ApiError(403, 'Guests do not have notifications', { code: 'guest_not_allowed' });
    }

    const unreadOnly = request.nextUrl.searchParams.get('unread') !== 'false';
    const notifications = await listNotifications(user.uid, { unreadOnly, limit: 50 });

    return NextResponse.json({ notifications });
  } catch (error) {
    return handleApiError(error);
  }
}
