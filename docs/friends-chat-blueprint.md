# WordMates Social + Chat Blueprint

_Last updated: 2025-11-18_

## Objectives

- Provide a production-ready friends system with requests, presence, and persistent chats for authenticated players.
- Deliver contextual lobby/game chat bubbles that automatically fall back to temporary rooms whenever a guest participates.
- Centralize all social features behind secure Firebase Admin routes so that logic lives on the backend.
- Surface real-time notifications (chat entry, friend requests, acceptances) and enforce guest restrictions with clear messaging.

## Firestore Data Model

| Collection                            | Purpose                                                                             | Key Fields                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `users/{userId}`                      | Existing profile source; ensure `isGuest`, `username`, `displayName`, `lastSeenAt`. | _Existing fields plus `isGuest` flag_                              |
| `friend_requests/{requestId}`         | Tracks pending/accepted/declined invites.                                           | `from`, `to`, `status`, `createdAt`, `updatedAt`, `message?`       |
| `friendships/{friendshipId}`          | Denormalized relationship doc.                                                      | `userIds`, `createdAt`, `lastInteractionAt`, `blockedBy?`          |
| `chats/{chatId}`                      | Chat metadata.                                                                      | `type (persistent                                                  | temporary)`, `scope (friend | lobby | game)`, `lobbyId?`, `gameId?`, `memberIds`, `guestAllowed`, `createdBy`, `createdAt`, `lastMessageAt` |
| `chats/{chatId}/messages/{messageId}` | Chat transcript.                                                                    | `senderId`, `text`, `attachments?`, `sentAt`, `system`             |
| `chat_memberships/{chatId_userId}`    | Read-state and preferences per member.                                              | `chatId`, `userId`, `temporary`, `lastReadAt`, `joinedAt`, `muted` |
| `notifications/{notificationId}`      | Real-time events for players.                                                       | `userId`, `type`, `payload`, `createdAt`, `read`                   |
| `sessionLocks/{userId}`               | Existing heartbeat doc; extend with `activeChatId?`.                                | `lastSeenAt`, `activeChatId`                                       |

### Indexing Guidelines

- `friend_requests`: composite indexes for `(to, status)` and `(from, status)`.
- `friendships`: single-field index on `userIds` array for membership queries.
- `chats`: composite indexes for `(scope, lobbyId)` and `(scope, gameId)` to fetch room per context.
- `messages`: single-field index on `sentAt` (default) plus optional `(chatId, sentAt)` query scope.
- `notifications`: `(userId, read)` for inbox batching.

## Domain Rules

1. **Guests cannot use the friends system.** API guards reject any anonymous session with status `403`. Frontend intercepts the Friends button and shows "Sign in to manage friends and persistent chats" CTA.
2. **Chat persistence depends on membership:**
   - All-authenticated lobby/game members → persistent room keyed to lobby/game id.
   - Any guest present → temporary chat (flagged in metadata) that is deleted by a Cloud Function watcher when the lobby/game ends.
   - Friend-to-friend DMs always persistent and reuse the same room regardless of entry point (friends modal or chat bubble).
3. **Notifications fire when players enter chats:** entering a chat triggers a `chat-entry` notification to other authenticated members. Temporary (guest) rooms skip notifications to avoid noise.
4. **Requests & friendships are always symmetric:** doc ids follow `${minUserId}_${maxUserId}` to prevent duplicates.
5. **All writes happen through Next.js route handlers using Firebase Admin.** Clients never write directly to Firestore for these collections, simplifying rule maintenance.

## API Surface (Next.js Route Handlers)

| Method | Path                    | Summary                                                                                                                    |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/friends/request`  | Auth player sends invite by username or userId. Validates no existing friendship/request.                                  |
| `POST` | `/api/friends/respond`  | Accept/decline/cancel existing request. Accept flow creates friendship + persistent chat + notifications.                  |
| `GET`  | `/api/friends`          | Returns list of friends with presence (joins with `sessionLocks`).                                                         |
| `GET`  | `/api/friends/requests` | Lists incoming/outgoing requests (optional query param `direction`).                                                       |
| `POST` | `/api/chats/open`       | Resolves/creates a chat for a `context` (`friend`, `lobby`, `game`). Applies guest rules and ensures memberships exist.    |
| `POST` | `/api/chats/message`    | Validates membership and appends a message document.                                                                       |
| `POST` | `/api/chats/enter`      | Marks `chat_memberships.lastReadAt`, sets `sessionLocks.activeChatId`, emits `chat-entry` notifications (auth users only). |
| `GET`  | `/api/notifications`    | Returns unread notifications. Optional `PATCH /api/notifications/{id}` to mark read.                                       |

## Guest Handling

- Friends modal button dispatches `useToast` warning for guests; no API call.
- Lobby/game chat bubble still opens but uses temporary chat logic, and data never appears in friends modal after leaving the session.
- Temporary chats flagged with `guestAllowed: true` and skip persistent membership writes.

## UI/UX Requirements

1. **Friends Modal** (desktop & mobile): Tabs for `Friends`, `Requests`, `Search`, `Notifications`. Each tab pulls from the APIs above. Search allows username lookup and shows CTA if user is a guest. Requests tab supports accept/decline.
2. **Chat Bubble**: floating pill in lobby/game pages. Unread badge leverages `chat_memberships.lastReadAt`. For authenticated players, `Open in Friends` button deep-links to modal reusing chat data.
3. **Notifications Badge**: `user-menu` shows total unread notifications. Each chat entry toast uses `useToast` hook.

## Implementation Plan

1. **Server utilities** in `src/lib/social/` for Firestore helpers (friendships, chat creation, notifications).
2. **API route handlers** under `src/app/api` matching the table above.
3. **Client hooks/components** for data fetching (`useFriends`, `useFriendRequests`, `useChatRoom`).
4. **Friends modal UI** + gating message for guests.
5. **Lobby/Game chat bubble** integrated into `src/app/game/[gameId]/page.tsx` and `src/app/lobby/[gameId]/page.tsx` plus shared component.
6. **Notification plumbing** in `firebase-provider` to subscribe to snapshot listeners and show toasts.
7. **Testing**: run `npm run lint`, add unit tests for helper utilities (if applicable), and manual smoke across lobby/game flows.

## Open Questions (future iterations)

- Should we add media/attachment support for chat? (deferred)
- Rate limiting on chat messages? (deferred but easy via Firestore security rules + middleware)
- Push notifications via FCM? (not in scope for this milestone).
