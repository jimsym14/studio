import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { markNotificationsRead } from '@/lib/social/notifications';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    if (user.isGuest) {
      throw new ApiError(403, 'Guests do not have notifications', { code: 'guest_not_allowed' });
    }

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) {
      throw new ApiError(400, 'Provide notification ids', { code: 'invalid_request' });
    }

    const updated = await markNotificationsRead(user.uid, ids);
    return NextResponse.json({ updated });
  } catch (error) {
    return handleApiError(error);
  }
}
