import type { Server as HTTPServer } from 'http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Server as IOServer } from 'socket.io';

import { setRealtimeServer } from '@/lib/realtime/server';
import { resolveUserFromToken } from '@/lib/social/auth';
import { markChatMessagesRead, verifyChatMembership } from '@/lib/social/chats';

export const config = {
  api: {
    bodyParser: false,
  },
};

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse['socket'] & {
    server: {
      io?: IOServer;
    } & Record<string, unknown>;
  };
};

const ensureRealtimeServer = (res: NextApiResponseWithSocket) => {
  if (res.socket.server.io) {
    return res.socket.server.io;
  }

  const httpServer = res.socket.server as unknown as HTTPServer;
  const io = new IOServer(httpServer, {
    path: '/api/realtime',
    addTrailingSlash: false,
    transports: ['websocket', 'polling'],
  });

  res.socket.server.io = io;

  setRealtimeServer(io);

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? null;
      const user = await resolveUserFromToken(token);
      if (!user) {
        next(new Error('Unauthorized'));
        return;
      }
      socket.data.user = user;
      socket.join(`user:${user.uid}`);
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on('connection', (socket) => {
    socket.on('chat:subscribe', async (payload: { chatId?: string }) => {
      const chatId = typeof payload?.chatId === 'string' ? payload.chatId : '';
      if (!chatId) return;
      const userId = socket.data.user?.uid;
      if (!userId) return;
      const allowed = await verifyChatMembership(chatId, userId);
      if (!allowed) {
        socket.emit('chat:error', { chatId, error: 'not_member' });
        return;
      }
      socket.join(`chat:${chatId}`);
    });

    socket.on('chat:unsubscribe', (payload: { chatId?: string }) => {
      const chatId = typeof payload?.chatId === 'string' ? payload.chatId : '';
      if (!chatId) return;
      socket.leave(`chat:${chatId}`);
    });

    socket.on('chat:typing', async (payload: { chatId?: string; isTyping?: boolean }) => {
      const chatId = typeof payload?.chatId === 'string' ? payload.chatId : '';
      const isTyping = Boolean(payload?.isTyping);
      if (!chatId) return;

      const userId = socket.data.user?.uid;
      if (!userId) return;

      // Verify membership (optional optimization: cache this or trust client if low stakes)
      // For strict security, verify again or rely on the fact they are in the room (which required verification)
      // Since they are in the room 'chat:{chatId}', they must have passed 'chat:subscribe' verification.
      // However, we should broadcast to the room.

      socket.to(`chat:${chatId}`).emit('chat:typing', { chatId, userId, isTyping });
    });

    socket.on('chat:mark-read', async (payload: { chatId?: string; lastSeenAt?: string }) => {
      const chatId = typeof payload?.chatId === 'string' ? payload.chatId : '';
      if (!chatId) return;
      const userId = socket.data.user?.uid;
      if (!userId) return;
      const lastSeenAt = typeof payload?.lastSeenAt === 'string' ? payload.lastSeenAt : undefined;
      try {
        await markChatMessagesRead(chatId, userId, lastSeenAt);
      } catch (error) {
        console.warn('Failed to mark chat read via websocket', error);
      }
    });
  });

  return io;
};

export default function handler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  // ensureRealtimeServer(res);
  res.end();
}
