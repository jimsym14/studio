import { NextRequest, NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/social/auth';
import { handleApiError, ApiError } from '@/lib/social/errors';
import { toggleChatReaction } from '@/lib/social/chats';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const user = await requireRequestUser(request);
        const body = await request.json().catch(() => ({}));
        const chatId = typeof body.chatId === 'string' ? body.chatId : '';
        const messageId = typeof body.messageId === 'string' ? body.messageId : '';
        const emoji = typeof body.emoji === 'string' ? body.emoji : '';

        if (!chatId || !messageId) {
            throw new ApiError(400, 'Missing chatId or messageId', { code: 'invalid_request' });
        }

        const result = await toggleChatReaction(chatId, messageId, user.uid, emoji);

        return NextResponse.json({ message: result });
    } catch (error) {
        return handleApiError(error);
    }
}
