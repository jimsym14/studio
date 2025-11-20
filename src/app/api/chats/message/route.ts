import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { ApiError, handleApiError } from '@/lib/social/errors';
import { sendChatMessage } from '@/lib/social/chats';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json().catch(() => ({}));
    const chatId = typeof body.chatId === 'string' ? body.chatId : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const replyToRaw = typeof body.replyTo === 'object' && body.replyTo !== null ? body.replyTo : null;
    const replyToMessageId = typeof body.replyToMessageId === 'string'
      ? body.replyToMessageId
      : replyToRaw && typeof replyToRaw.messageId === 'string'
        ? replyToRaw.messageId
        : undefined;
    const clientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId : undefined;

    if (!chatId) {
      throw new ApiError(400, 'Missing chatId', { code: 'invalid_request' });
    }

    const result = await sendChatMessage(chatId, user.uid, text, {
      isGuest: user.isGuest,
      replyToMessageId,
      clientMessageId,
    });

    return NextResponse.json({ message: result });
  } catch (error) {
    return handleApiError(error);
  }
}
