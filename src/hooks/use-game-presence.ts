import { useEffect, useState } from 'react';
import { ref, onValue, set, onDisconnect, serverTimestamp, remove } from 'firebase/database';
import { useFirebase } from '@/components/firebase-provider';

export type GamePresenceUser = {
    userId: string;
    online: boolean;
    lastSeen: number;
};

export function useGamePresence(gameId: string | null) {
    const { rtdb, user } = useFirebase();
    const [activePlayers, setActivePlayers] = useState<GamePresenceUser[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!rtdb || !gameId || !user) {
            setLoading(false);
            return;
        }

        const presenceRef = ref(rtdb, `games/${gameId}/presence/${user.uid}`);
        const gamePresenceRef = ref(rtdb, `games/${gameId}/presence`);

        // Set initial presence
        set(presenceRef, {
            online: true,
            lastSeen: serverTimestamp(),
        }).catch((err) => console.error('Failed to set game presence:', err));

        // Set disconnect handler
        onDisconnect(presenceRef).remove();

        // Listen for all players in this game
        const unsubscribe = onValue(gamePresenceRef, (snapshot) => {
            const data = snapshot.val() as Record<string, { online: boolean; lastSeen: number }> | null;

            if (!data) {
                setActivePlayers([]);
            } else {
                const players = Object.entries(data).map(([userId, presence]) => ({
                    userId,
                    online: presence.online,
                    lastSeen: presence.lastSeen,
                }));
                setActivePlayers(players);
            }
            setLoading(false);
        });

        return () => {
            // Cleanup: remove presence when unmounting/leaving
            remove(presenceRef).catch(() => { });
            onDisconnect(presenceRef).cancel();
            unsubscribe();
        };
    }, [rtdb, gameId, user]);

    return {
        activePlayers,
        loading,
        isOpponentOnline: (opponentId: string) => activePlayers.some(p => p.userId === opponentId && p.online),
    };
}
