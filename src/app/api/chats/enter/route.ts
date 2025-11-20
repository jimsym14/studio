import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { recordChatEntry } from '@/lib/social/chats';

export const dynamic = 'force-dynamic';

const normalizeAction = (value: unknown): 'enter' | 'leave' => {
  if (typeof value !== 'string') return 'enter';
  return value.toLowerCase() === 'leave' ? 'leave' : 'enter';
};

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const chatId = typeof body.chatId === 'string' ? body.chatId : '';
    const action = normalizeAction(body.action);

    if (!chatId) {
      throw new ApiError(400, 'Missing chatId', { code: 'invalid_request' });
    }

    const result = await recordChatEntry(chatId, user.uid, { action, isGuest: user.isGuest });

    return NextResponse.json({ chat: result });
  } catch (error) {
    return handleApiError(error);
  }
}
