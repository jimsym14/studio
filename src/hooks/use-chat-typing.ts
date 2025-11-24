import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, onDisconnect, serverTimestamp, remove } from 'firebase/database';
import { useFirebase } from '@/components/firebase-provider';

export type TypingUser = {
    userId: string;
    isTyping: boolean;
    lastTyped: number;
};

const TYPING_TIMEOUT_MS = 5000;

export function useChatTyping(chatId: string | null) {
    const { rtdb, user } = useFirebase();
    const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Function to set typing status
    const setIsTyping = useCallback((isTyping: boolean) => {
        if (!rtdb || !chatId || !user) return;

        const typingRef = ref(rtdb, `chats/${chatId}/typing/${user.uid}`);

        if (isTyping) {
            // Set typing status
            set(typingRef, {
                isTyping: true,
                lastTyped: serverTimestamp(),
            }).catch((err) => console.error('Failed to set typing status:', err));

            // Auto-remove on disconnect
            onDisconnect(typingRef).remove();

            // Clear existing timeout
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }

            // Auto-clear typing after timeout
            typingTimeoutRef.current = setTimeout(() => {
                remove(typingRef).catch(() => { });
            }, TYPING_TIMEOUT_MS);
        } else {
            // Clear typing status immediately
            remove(typingRef).catch(() => { });
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
        }
    }, [rtdb, chatId, user]);

    // Listen for typing updates
    useEffect(() => {
        if (!rtdb || !chatId) {
            setTypingUsers([]);
            return;
        }

        const chatTypingRef = ref(rtdb, `chats/${chatId}/typing`);

        const unsubscribe = onValue(chatTypingRef, (snapshot) => {
            const data = snapshot.val() as Record<string, { isTyping: boolean; lastTyped: number }> | null;

            if (!data) {
                setTypingUsers([]);
            } else {
                const now = Date.now();
                const users = Object.entries(data)
                    .map(([userId, status]) => ({
                        userId,
                        isTyping: status.isTyping,
                        lastTyped: status.lastTyped,
                    }))
                    // Filter out stale typing indicators (older than timeout + buffer)
                    // Note: serverTimestamp is mostly accurate, but client clock might drift.
                    // We rely on the timeout clearing it, but this is a safety check.
                    .filter(u => u.isTyping && (now - u.lastTyped < TYPING_TIMEOUT_MS + 2000));

                setTypingUsers(users);
            }
        });

        return () => unsubscribe();
    }, [rtdb, chatId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
            // We don't strictly need to remove presence here as onDisconnect handles it,
            // but it's good practice if we navigate away while typing.
            if (rtdb && chatId && user) {
                const typingRef = ref(rtdb, `chats/${chatId}/typing/${user.uid}`);
                remove(typingRef).catch(() => { });
            }
        };
    }, [rtdb, chatId, user]);

    return {
        typingUsers,
        setIsTyping,
        isPeerTyping: (peerId: string) => typingUsers.some(u => u.userId === peerId && u.isTyping),
    };
}
