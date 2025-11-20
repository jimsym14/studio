import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    const prevConnectionRef = useRef<boolean>(false);

    const applySnapshot = useCallback((data: {
        messages: ChatMessagePayload[];
        readReceipts: Record<string, string | null>;
        membership: { lastReadAt?: string | null } | null;
        lastMessageAt?: string | null;
    }) => {
        setMessages(data.messages.map(m => ({ ...m, sentAt: m.sentAt ?? undefined, pending: false, failed: false })));

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
        if (!chatId || refreshInFlightRef.current) return;
        refreshInFlightRef.current = true;
        try {
            await fetchMessagesForChatId(chatId);
        } catch (err) {
            console.error('Failed to refresh chat messages', err);
        } finally {
            refreshInFlightRef.current = false;
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
        if (!socket || !connected || !chatId) return;

        let destroyed = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const subscribeToChat = () => {
            if (destroyed) return;
            socket.emit('chat:subscribe', { chatId });
        };

        subscribeToChat();

        const handleMessage = (payload: { chatId: string; message: ChatMessagePayload }) => {
            if (payload.chatId !== chatId) return;
            const incoming: ChatMessage = {
                ...payload.message,
                pending: false,
                failed: false,
                sentAt: payload.message.sentAt ?? new Date().toISOString(),
            };
            setMessages(prev => {
                const byId = prev.findIndex(m => m.id === incoming.id);
                const byClientId = incoming.clientMessageId
                    ? prev.findIndex(m => m.clientMessageId === incoming.clientMessageId)
                    : -1;
                const replaceIndex = byId !== -1 ? byId : byClientId;
                if (replaceIndex !== -1) {
                    const next = [...prev];
                    next[replaceIndex] = { ...prev[replaceIndex], ...incoming, pending: false, failed: false };
                    return next;
                }
                return [...prev, incoming];
            });
            if (incoming.sentAt) {
                const sentAtDate = new Date(incoming.sentAt);
                setLastMessageAt(sentAtDate);
                if (incoming.senderId) {
                    setReadReceipts(prev => ({
                        ...prev,
                        [incoming.senderId]: sentAtDate,
                    }));
                }
            }
            if (payload.message.senderId !== userId) {
                void refreshMessages();
            }
        };

        const handleRead = (payload: { chatId: string; userId: string; lastReadAt: string | null }) => {
            if (payload.chatId !== chatId) return;
            setReadReceipts(prev => {
                if (!payload.lastReadAt) {
                    const next = { ...prev };
                    delete next[payload.userId];
                    return next;
                }
                return {
                    ...prev,
                    [payload.userId]: new Date(payload.lastReadAt),
                };
            });

            if (payload.userId === userId) {
                if (payload.lastReadAt) {
                    const parsed = new Date(payload.lastReadAt);
                    setMembership(current => ({ ...(current ?? {}), lastReadAt: parsed }));
                    lastMarkedReadAtRef.current = parsed.getTime();
                } else {
                    setMembership(current => (current ? { ...current, lastReadAt: undefined } : current));
                    lastMarkedReadAtRef.current = 0;
                }
            }
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

        socket.on('chat:message', handleMessage);
        socket.on('chat:read', handleRead);
        socket.on('chat:typing', handleTyping);
        socket.on('chat:error', handleError);

        return () => {
            destroyed = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
            }
            socket.emit('chat:unsubscribe', { chatId });
            socket.off('chat:message', handleMessage);
            socket.off('chat:read', handleRead);
            socket.off('chat:typing', handleTyping);
            socket.off('chat:error', handleError);
        };
    }, [socket, connected, chatId, userId, refreshMessages]);

    

    const markMessagesRead = useCallback((options?: { lastSeenAt?: string }) => {
        if (!socket || !connected || !chatId || !userId) return;
        const latest = options?.lastSeenAt ?? messages[messages.length - 1]?.sentAt;
        if (!latest) return;
        const timestamp = new Date(latest).getTime();
        if (!Number.isFinite(timestamp)) return;
        if (timestamp <= lastMarkedReadAtRef.current) return;
        lastMarkedReadAtRef.current = timestamp;
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
        sendTyping
    };
}
