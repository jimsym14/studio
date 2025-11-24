import { NextRequest, NextResponse } from 'next/server';
import { requireRequestUser } from '@/lib/social/auth';
import { markChatMessagesRead } from '@/lib/social/chats';

export async function POST(request: NextRequest) {
    try {
        const user = await requireRequestUser(request);

        const body = await request.json();
        const { chatId, lastSeenAt } = body;

        if (!chatId || typeof chatId !== 'string') {
            return NextResponse.json({ error: 'Invalid chatId' }, { status: 400 });
        }

        await markChatMessagesRead(chatId, user.uid, lastSeenAt);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error in mark-read API:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
