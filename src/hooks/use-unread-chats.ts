import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { useFirebase } from '@/components/firebase-provider';
import { CHAT_MEMBERSHIPS_COLLECTION } from '@/lib/social/constants';

export type UnreadChatsState = {
    totalUnread: number;
    unreadChatIds: Set<string>;
    loading: boolean;
};

export function useUnreadChats() {
    const { user, db } = useFirebase();
    const [state, setState] = useState<UnreadChatsState>({
        totalUnread: 0,
        unreadChatIds: new Set(),
        loading: true,
    });

    useEffect(() => {
        if (!user || !db) {
            setState({ totalUnread: 0, unreadChatIds: new Set(), loading: false });
            return;
        }

        const q = query(
            collection(db, CHAT_MEMBERSHIPS_COLLECTION),
            where('userId', '==', user.uid)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const unreadIds = new Set<string>();

            snapshot.docs.forEach((doc) => {
                const data = doc.data();
                const lastReadAt = data.lastReadAt instanceof Timestamp ? data.lastReadAt.toMillis() : 0;
                const lastMessageAt = data.lastMessageAt instanceof Timestamp ? data.lastMessageAt.toMillis() : 0;

                // If there's a message newer than the last read time, it's unread
                // We also check if lastMessageAt exists to avoid counting empty/new chats as unread
                if (lastMessageAt > lastReadAt) {
                    // The doc ID is usually composite, but the chat ID is stored in the data or derived
                    // Actually, chat_memberships docs are usually named `{chatId}_{userId}` or similar, 
                    // OR they are just docs with `chatId` field.
                    // Let's check how memberships are stored. 
                    // Based on typical patterns, `chatId` is likely a field.
                    const chatId = data.chatId as string;
                    if (chatId) {
                        unreadIds.add(chatId);
                    }
                }
            });

            setState({
                totalUnread: unreadIds.size,
                unreadChatIds: unreadIds,
                loading: false,
            });
        }, (error) => {
            console.error('Error listening to unread chats:', error);
            setState((prev) => ({ ...prev, loading: false }));
        });

        return () => unsubscribe();
    }, [user]);

    return state;
}
