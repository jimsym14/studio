'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { ref, onValue, set, onDisconnect, serverTimestamp, remove } from 'firebase/database';
import { useFirebase } from '@/components/firebase-provider';

export type TypingState = {
    guess: string;
    rowIndex: number;
    timestamp: number;
};

export function useGameTyping(gameId: string | null, isEnabled: boolean = true) {
    const { rtdb, user } = useFirebase();
    const [peerTyping, setPeerTyping] = useState<Record<string, TypingState>>({});
    const typingRef = useRef<Record<string, TypingState>>({});

    // Function to broadcast my typing state
    const broadcastTyping = useCallback((guess: string, rowIndex: number) => {
        if (!isEnabled || !rtdb || !gameId || !user) return;

        const myTypingRef = ref(rtdb, `games/${gameId}/typing/${user.uid}`);
        // If empty guess, we might want to just set it to empty string or remove?
        // Setting it is safer to ensure it clears for others.
        set(myTypingRef, {
            guess,
            rowIndex,
            timestamp: serverTimestamp(),
        }).catch((err) => console.error('Failed to broadcast typing:', err));

        // Ensure it clears on disconnect
        onDisconnect(myTypingRef).remove();
    }, [rtdb, gameId, user, isEnabled]);

    // Function to clear my typing state (e.g. after submit)
    const clearTyping = useCallback(() => {
        if (!isEnabled || !rtdb || !gameId || !user) return;
        const myTypingRef = ref(rtdb, `games/${gameId}/typing/${user.uid}`);
        remove(myTypingRef).catch((err) => console.error('Failed to clear typing:', err));
    }, [rtdb, gameId, user, isEnabled]);

    useEffect(() => {
        if (!isEnabled || !rtdb || !gameId) {
            setPeerTyping({});
            return;
        }

        const allTypingRef = ref(rtdb, `games/${gameId}/typing`);
        const unsubscribe = onValue(allTypingRef, (snapshot) => {
            const data = snapshot.val() as Record<string, TypingState> | null;
            if (data) {
                // Filter out my own typing if needed, but easier to just store everything and filter in UI
                typingRef.current = data;
                setPeerTyping(data);
            } else {
                typingRef.current = {};
                setPeerTyping({});
            }
        });

        return () => unsubscribe();
    }, [rtdb, gameId, isEnabled]);

    return {
        peerTyping,
        broadcastTyping,
        clearTyping,
    };
}
