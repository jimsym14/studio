import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { initializeFirebase } from '@/lib/firebase';
import { useRealtime } from '@/components/realtime-provider';
import { useFirebase } from '@/components/firebase-provider';
import { useToast } from '@/hooks/use-toast';
import type { ChatContextDescriptor } from '@/types/social';
import type { ChatMessagePayload } from '@/types/chat';
import { socialPost } from '@/lib/social-client';

const generateClientMessageId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const buildContextKey = (context: ChatContextDescriptor) => {
    if (context.scope === 'friend') {
        return `friend:${context.friendshipId ?? context.friendUserId}`;
    }
    if (context.scope === 'lobby') {
        return `lobby:${context.lobbyId}`;
    }
    if (context.scope === 'game') {
        return `game:${context.gameId}`;
    }
    return 'unknown';
};

const chatIdCache = new Map<string, string>();
const chatInitPromises = new Map<string, Promise<string>>();

const getMessageKey = (message: { id?: string | null; clientMessageId?: string | null }) => {
    return message.id ?? message.clientMessageId ?? null;
};

const normalizeChatMessage = (payload: ChatMessagePayload): ChatMessage => ({
    ...payload,
    reactions: payload.reactions || {},
    sentAt: payload.sentAt ?? undefined,
    pending: false,
    failed: false,
});

const resolveChatId = (cacheKey: string, opener: () => Promise<{ chat: { id?: string; chatId?: string } }>) => {
    if (chatIdCache.has(cacheKey)) {
        return Promise.resolve(chatIdCache.get(cacheKey)!);
    }
    const existing = chatInitPromises.get(cacheKey);
    if (existing) {
        return existing;
    }
    const promise = opener()
        .then(({ chat }) => {
            const newChatId = chat.id ?? chat.chatId ?? '';
            if (!newChatId) {
                throw new Error('Chat response missing id');
            }
            chatIdCache.set(cacheKey, newChatId);
            chatInitPromises.delete(cacheKey);
            return newChatId;
        })
        .catch((error) => {
            chatInitPromises.delete(cacheKey);
            throw error;
        });
    chatInitPromises.set(cacheKey, promise);
    return promise;
};

export type ChatMessage = ChatMessagePayload & {
    pending?: boolean;
    failed?: boolean;
};

export type UseChatRoomOptions = {
    context: ChatContextDescriptor;
    enabled?: boolean;
};

export function useChatRoom({ context, enabled = true }: UseChatRoomOptions) {
    const { socket, connected } = useRealtime();
    const { db } = useMemo(() => initializeFirebase(), []);
    const { userId } = useFirebase();
    const { toast } = useToast();
    const contextKey = useMemo(() => buildContextKey(context), [context]);
    const cacheKey = useMemo(() => (userId && contextKey ? `${userId}:${contextKey}` : null), [contextKey, userId]);
    const openChatPayload = useMemo(() => {
        if (context.scope === 'friend') {
            return {
                endpoint: '/api/chats/open',
                body: { context: 'friend', friendshipId: context.friendshipId, userId: context.friendUserId },
            } as const;
        }
        if (context.scope === 'lobby') {
            return {
                endpoint: '/api/chats/open',
                body: { context: 'lobby', lobbyId: context.lobbyId },
            } as const;
        }
        if (context.scope === 'game') {
            return {
                endpoint: '/api/chats/open',
                body: { context: 'game', gameId: context.gameId },
            } as const;
        }
        return null;
    }, [context]);

    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatId, setChatId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [typingUsers, setTypingUsers] = useState<string[]>([]);
    const [readReceipts, setReadReceipts] = useState<Record<string, Date>>({});
    const [membership, setMembership] = useState<{ lastReadAt?: Date } | null>(null);
    const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null);
    const lastMarkedReadAtRef = useRef(0);
    const refreshInFlightRef = useRef(false);
    const pendingRefreshRef = useRef(false);
    const prevConnectionRef = useRef<boolean>(false);

    const applySnapshot = useCallback((data: {
        messages: ChatMessagePayload[];
        readReceipts: Record<string, string | null>;
        membership: { lastReadAt?: string | null } | null;
        lastMessageAt?: string | null;
    }) => {
        setMessages(prev => {
            const normalized = data.messages.map(normalizeChatMessage);
            const knownKeys = new Set((normalized.map(entry => getMessageKey(entry)).filter(Boolean)) as string[]);
            const extras = prev.filter(entry => {
                const key = getMessageKey(entry);
                if (!key) return true;
                return !knownKeys.has(key);
            });
            const merged = [...normalized, ...extras];
            merged.sort((a, b) => {
                const aTime = a.sentAt ? new Date(a.sentAt).getTime() : 0;
                const bTime = b.sentAt ? new Date(b.sentAt).getTime() : 0;
                return aTime - bTime;
            });
            return merged;
        });

        const parsedReceipts: Record<string, Date> = {};
        Object.entries(data.readReceipts).forEach(([uid, ts]) => {
            if (ts) parsedReceipts[uid] = new Date(ts);
        });
        setReadReceipts(parsedReceipts);

        if (data.membership?.lastReadAt) {
            const parsed = new Date(data.membership.lastReadAt);
            setMembership({ lastReadAt: parsed });
            lastMarkedReadAtRef.current = parsed.getTime();
        } else if (data.membership) {
            setMembership({ lastReadAt: undefined });
            lastMarkedReadAtRef.current = 0;
        } else {
            setMembership(null);
            lastMarkedReadAtRef.current = 0;
        }

        setLastMessageAt(data.lastMessageAt ? new Date(data.lastMessageAt) : null);
    }, []);

    const fetchMessagesForChatId = useCallback(async (targetChatId: string) => {
        const data = await socialPost('/api/chats/messages', { chatId: targetChatId }) as {
            messages: ChatMessagePayload[];
            readReceipts: Record<string, string | null>;
            membership: { lastReadAt?: string | null } | null;
            lastMessageAt?: string | null;
        };
        applySnapshot(data);
    }, [applySnapshot]);

    const refreshMessages = useCallback(async () => {
        if (!chatId) return;
        if (refreshInFlightRef.current) {
            pendingRefreshRef.current = true;
            return;
        }
        refreshInFlightRef.current = true;
        pendingRefreshRef.current = false;
        try {
            await fetchMessagesForChatId(chatId);
        } catch (err) {
            console.error('Failed to refresh chat messages', err);
        } finally {
            refreshInFlightRef.current = false;
            if (pendingRefreshRef.current) {
                pendingRefreshRef.current = false;
                // Recursively run the queued refresh so we never miss a server snapshot.
                void refreshMessages();
            }
        }
    }, [chatId, fetchMessagesForChatId]);

    // Initialize chat
    useEffect(() => {
        if (!enabled || !userId || !cacheKey || !openChatPayload) {
            setStatus('idle');
            return;
        }

        let mounted = true;

        const initChat = async () => {
            setStatus('loading');
            try {
                const newChatId = await resolveChatId(
                    cacheKey,
                    () => socialPost(openChatPayload.endpoint, openChatPayload.body) as Promise<{ chat: { id?: string; chatId?: string } }>
                );

                if (mounted) {
                    setChatId(newChatId);
                    await fetchMessagesForChatId(newChatId);
                    if (!mounted) return;
                    setStatus('ready');
                }
            } catch (err) {
                console.error('Failed to init chat:', err);
                if (mounted) {
                    setError(err instanceof Error ? err.message : 'Failed to connect to chat');
                    setStatus('error');
                }
            }
        };

        void initChat();

        return () => {
            mounted = false;
        };
    }, [cacheKey, enabled, fetchMessagesForChatId, openChatPayload, userId]);

    // Socket subscriptions
    useEffect(() => {
        if (!socket || !chatId) return;

        let destroyed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const subscribeToChat = () => {
            if (destroyed) return;
            socket.emit('chat:subscribe', { chatId });
        };

        if (socket.connected) {
            subscribeToChat();
        }

        const handleConnect = () => {
            subscribeToChat();
        };

        const handleTyping = (payload: { chatId: string; userId: string; isTyping: boolean }) => {
            if (payload.chatId !== chatId) return;
            setTypingUsers(prev => {
                if (payload.isTyping) {
                    return prev.includes(payload.userId) ? prev : [...prev, payload.userId];
                }
                return prev.filter(id => id !== payload.userId);
            });
        };

        const handleError = (payload: { chatId: string; error?: string }) => {
            if (payload.chatId !== chatId) return;
            if (payload.error === 'not_member') {
                if (retryTimer) {
                    clearTimeout(retryTimer);
                }
                retryTimer = setTimeout(() => {
                    if (destroyed) return;
                    void refreshMessages();
                    subscribeToChat();
                }, 500);
            }
        };

        socket.on('connect', handleConnect);
        socket.on('chat:typing', handleTyping);
        socket.on('chat:error', handleError);

        return () => {
            destroyed = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
            }
            socket.emit('chat:unsubscribe', { chatId });
            socket.off('connect', handleConnect);
            socket.off('chat:typing', handleTyping);
            socket.off('chat:error', handleError);
        };
    }, [socket, chatId, userId, refreshMessages]);

    // Firestore subscriptions
    useEffect(() => {
        if (!chatId || !db) return;

        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const q = query(messagesRef, orderBy('sentAt', 'asc'), limit(100));

        const unsubscribeMessages = onSnapshot(q, (snapshot) => {
            const serverMessages = snapshot.docs.map(doc => {
                const data = doc.data();
                const sentAt = data.sentAt instanceof Timestamp
                    ? data.sentAt.toDate().toISOString()
                    : (typeof data.sentAt === 'string' ? data.sentAt : new Date().toISOString());

                return {
                    id: doc.id,
                    senderId: data.senderId,
                    text: data.text,
                    sentAt,
                    isSystem: data.system,
                    clientMessageId: data.clientMessageId,
                    replyTo: data.replyTo ? {
                        id: data.replyTo.messageId,
                        senderId: data.replyTo.senderId,
                        text: data.replyTo.text,
                    } : undefined,
                    reactions: data.reactions || {},
                    pending: false,
                    failed: false,
                } as ChatMessage;
            });

            setMessages(prev => {
                const pending = prev.filter(m => m.pending);
                const serverClientIds = new Set(serverMessages.map(m => m.clientMessageId).filter(Boolean));
                const remainingPending = pending.filter(m => !m.clientMessageId || !serverClientIds.has(m.clientMessageId));
                return [...serverMessages, ...remainingPending];
            });

            if (serverMessages.length > 0) {
                const lastMsg = serverMessages[serverMessages.length - 1];
                if (lastMsg.sentAt) {
                    setLastMessageAt(new Date(lastMsg.sentAt));
                }
            }
        });

        const chatRef = doc(db, 'chats', chatId);
        const unsubscribeChat = onSnapshot(chatRef, (snapshot) => {
            if (!snapshot.exists()) return;
            const data = snapshot.data();

            // Handle read receipts
            if (data.readReceipts) {
                const parsedReceipts: Record<string, Date> = {};
                Object.entries(data.readReceipts).forEach(([uid, ts]) => {
                    if (ts instanceof Timestamp) {
                        parsedReceipts[uid] = ts.toDate();
                    } else if (typeof ts === 'string') {
                        parsedReceipts[uid] = new Date(ts);
                    }
                });
                setReadReceipts(parsedReceipts);

                // Update own membership lastReadAt if available in readReceipts
                if (userId && parsedReceipts[userId]) {
                    const myReadAt = parsedReceipts[userId];
                    setMembership(current => ({ ...(current ?? {}), lastReadAt: myReadAt }));
                    lastMarkedReadAtRef.current = myReadAt.getTime();
                }
            }
        });

        return () => {
            unsubscribeMessages();
            unsubscribeChat();
        };
    }, [chatId, db, userId]);

    const markMessagesRead = useCallback((options?: { lastSeenAt?: string }) => {
        if (!socket || !connected || !chatId || !userId) return;
        const latest = options?.lastSeenAt ?? messages[messages.length - 1]?.sentAt;
        if (!latest) return;
        const timestamp = new Date(latest).getTime();
        if (!Number.isFinite(timestamp)) return;
        if (timestamp <= lastMarkedReadAtRef.current) return;
        lastMarkedReadAtRef.current = timestamp;

        // Optimistic update: immediately update local state
        const readAtDate = new Date(latest);
        setMembership(current => ({ ...(current ?? {}), lastReadAt: readAtDate }));

        socket.emit('chat:mark-read', { chatId, lastSeenAt: latest });
    }, [socket, connected, chatId, userId, messages]);

    const sendMessage = useCallback(async (text: string, options?: { replyTo?: ChatMessage | null }) => {
        if (!chatId || !userId) return;
        const trimmed = text.trim();
        if (!trimmed) return;
        const clientMessageId = generateClientMessageId();
        const optimisticMessage: ChatMessage = {
            id: clientMessageId,
            clientMessageId,
            senderId: userId,
            text: trimmed,
            sentAt: new Date().toISOString(),
            pending: true,
            failed: false,
            replyTo: options?.replyTo
                ? {
                    id: options.replyTo.id,
                    senderId: options.replyTo.senderId,
                    text: options.replyTo.text,
                }
                : undefined,
        };
        setMessages(prev => [...prev, optimisticMessage]);
        setSending(true);
        try {
            await socialPost('/api/chats/message', {
                chatId,
                text: trimmed,
                replyToMessageId: options?.replyTo?.id,
                clientMessageId,
            });
        } catch (err) {
            setMessages(prev => prev.filter(entry => entry.clientMessageId !== clientMessageId));
            toast({
                variant: 'destructive',
                title: 'Failed to send',
                description: 'Could not send message. Please try again.',
            });
            throw err;
        } finally {
            setSending(false);
        }
    }, [chatId, toast, userId]);

    useEffect(() => {
        if (!chatId || !connected) {
            prevConnectionRef.current = connected;
            return;
        }
        if (!prevConnectionRef.current && connected) {
            void refreshMessages();
        }
        prevConnectionRef.current = connected;
    }, [chatId, connected, refreshMessages]);

    const sendTyping = useCallback((isTyping: boolean) => {
        if (!socket || !chatId) return;
        socket.emit('chat:typing', { chatId, isTyping });
    }, [socket, chatId]);

    const sendReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!chatId || !userId) return;

        // Optimistic update
        setMessages(prev => prev.map(msg => {
            if (msg.id !== messageId) return msg;
            const currentReactions = { ...(msg.reactions || {}) };
            if (currentReactions[userId] === emoji) {
                delete currentReactions[userId];
            } else {
                currentReactions[userId] = emoji;
            }
            return { ...msg, reactions: currentReactions };
        }));

        try {
            await socialPost('/api/chats/reaction', {
                chatId,
                messageId,
                emoji
            });
        } catch (err) {
            // Revert on failure (simplified: just refresh or let the user retry, but ideally we'd revert state)
            console.error('Failed to send reaction', err);
            toast({
                variant: 'destructive',
                title: 'Failed to react',
                description: 'Could not update reaction.',
            });
            // Revert optimistic update
            setMessages(prev => prev.map(msg => {
                if (msg.id !== messageId) return msg;
                // This is tricky without knowing previous state exactly, but we can just fetch fresh data
                return msg;
            }));
            void refreshMessages();
        }
    }, [chatId, userId, toast, refreshMessages]);

    return {
        ready: status === 'ready',
        status,
        messages,
        lastMessageAt,
        sendMessage,
        sending,
        error,
        chatId,
        readReceipts,
        membership,
        refreshMessages,
        markMessagesRead,
        typingUsers,
        sendTyping,
        sendReaction
    };
}
