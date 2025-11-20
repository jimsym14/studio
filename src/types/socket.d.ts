import type { RequestUser } from '@/lib/social/types';

declare module 'socket.io' {
  interface SocketData {
    user?: RequestUser;
  }
}
