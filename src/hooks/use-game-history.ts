"use client";

import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot, Firestore } from 'firebase/firestore';
import type { GameDocument } from '@/types/game';

export type GameHistoryEntry = {
    id: string;
    gameType: 'solo' | 'multiplayer';
    multiplayerMode?: 'pvp' | 'co-op';
    status: string;
    completedAt: string;
    players: string[];
    winnerId?: string | null;
    playerAliases?: Record<string, string>;
    guesses?: unknown[];
    wordLength?: number;
    result?: 'win' | 'loss' | 'draw';
};

const MAX_HISTORY_LIMIT = 100;

export const useGameHistory = (db: Firestore | null, userId: string | null) => {
    const [games, setGames] = useState<GameHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!db || !userId) {
            setGames([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        // Query for games where the user participated and were completed
        const gamesQuery = query(
            collection(db, 'games'),
            where('players', 'array-contains', userId),
            where('status', '==', 'completed'),
            orderBy('completedAt', 'desc'),
            limit(MAX_HISTORY_LIMIT)
        );

        const unsubscribe = onSnapshot(
            gamesQuery,
            (snapshot) => {
                const gamesList = snapshot.docs.map((doc) => {
                    const data = doc.data() as GameDocument;

                    // Determine result for this user
                    let result: 'win' | 'loss' | 'draw' = 'draw';
                    if (data.winnerId) {
                        result = data.winnerId === userId ? 'win' : 'loss';
                    }

                    return {
                        id: doc.id,
                        gameType: data.gameType ?? 'solo',
                        multiplayerMode: data.multiplayerMode,
                        status: data.status ?? 'completed',
                        completedAt: data.completedAt ?? new Date().toISOString(),
                        players: data.players ?? [],
                        winnerId: data.winnerId,
                        playerAliases: data.playerAliases,
                        guesses: data.guesses,
                        wordLength: data.wordLength,
                        result,
                    } as GameHistoryEntry;
                });

                setGames(gamesList);
                setLoading(false);
            },
            (err) => {
                console.error('Failed to fetch game history:', err);
                setError('Failed to load game history');
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [db, userId]);

    return { games, loading, error };
};
