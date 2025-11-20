import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { listChatMessages } from '@/lib/social/chats';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const chatId = typeof body.chatId === 'string' ? body.chatId : '';
    const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;

    if (!chatId) {
      throw new ApiError(400, 'Missing chatId', { code: 'invalid_request' });
    }

    const payload = await listChatMessages(chatId, user.uid, { limit });
    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
