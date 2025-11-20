# Realtime system quickstart

## Architecture

1. **Socket hub (`pages/api/realtime.ts`)** – A single `socket.io` server runs on the existing Next.js Node runtime. Every client connects over `/api/realtime` using WebSockets only. The server authenticates each socket with a Firebase ID token and automatically joins `user:{uid}` rooms for person-specific pushes.
2. **Shared emitter utilities (`src/lib/realtime/server.ts`)** – Server-only helpers keep a reference to the active socket hub and expose `emitChatMessage`, `emitChatReadReceipt`, and `emitFriendEvent`. Any API route or server action can import these helpers to broadcast without caring about server lifecycle details.
3. **Domain emitters** – Chat and friends modules now call the emitters whenever something important happens (message sent, read receipt recorded, friend request updated). Other realtime domains can follow the same pattern: after persisting state, call an emitter with the right room key.
4. **Client provider (`RealtimeProvider`)** – The global provider (mounted in `components/providers.tsx`) opens a single socket for the entire app, refreshes Firebase tokens, and exposes `{ socket, connected }` via `useRealtime()`.
5. **Feature hooks** – `useChatRoom` subscriptions replaced the old polling loop by subscribing to `chat:message` and `chat:read` events. Friends UI listens for `friends:event` signals to refresh lists and badges. Home stats use live Firestore listeners, so no API polling remains.

## Extending realtime events

- Choose a deterministic room key (e.g., `team:{teamId}`) and have clients join it via `socket.emit('team:subscribe', { teamId })`.
- On the server, guard every subscription by checking the requester’s permissions before calling `socket.join`. Follow the chat membership example in `pages/api/realtime.ts`.
- After a successful mutation, emit to the room with the newest data. Prefer broadcasting the minimal payload (IDs and derived fields) and let the client reconcile.

## Local development checklist

1. Install the new dependencies (`socket.io` and `socket.io-client`) and start the dev server normally: `npm run dev` (which proxies through `scripts/dev-server.mjs`).
2. Ensure Firebase emulators or production Firestore credentials are configured so Firebase Auth tokens can be minted. The socket handshake reuses the same Firebase user session that REST APIs use.
3. When testing multiple browsers, open the network inspector and confirm a single `websocket` connection to `/api/realtime`. New chat messages should arrive instantly without `/api/chats/messages` spam.

## Deployment notes

- The realtime route runs in the Node.js (not Edge) runtime. When deploying to Vercel or another serverless host, make sure the project targets the standard Node server so `socket.io` can attach to the HTTP server. No additional config is needed beyond including the `pages/api/realtime.ts` file.
- If you use custom servers (e.g., Next `start` behind Docker), expose port 3000 and allow WebSocket upgrade traffic through your proxy or load balancer.
- Scaling: Because the socket hub lives in-process, each server instance maintains its own connection set. Use sticky sessions (or a managed socket service) if you need horizontal scale beyond a single Node instance.
- Monitoring: watch the logs for `Active lobbies listener failed` or `Completed games listener failed` – these messages surface Firestore permission/index problems that would otherwise silently break live stats.

## Operational tips

- **Adding new events** – Define a TypeScript payload in `src/types/realtime.ts`, emit through `emitToRoom`, and listen via `socket.on` in the relevant hook/component.
- **Auth troubleshooting** – If sockets immediately disconnect, verify Firebase tokens are available (the provider logs failures). Guests must still sign in anonymously so they have a valid ID token.
- **Backfills** – Keep the existing HTTP APIs for initial data loads. Realtime events are additive; they don’t replace the need to fetch the first page of data when a view mounts.
