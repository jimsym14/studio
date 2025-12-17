
import { useMemo } from 'react';
import { updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { useFirebase } from '@/components/firebase-provider';
import type { UserProfile } from '@/types/user';
import { getDailyDateIso, getDailyWord } from '@/lib/daily-word';

interface DailyStatsHook {
    dailyWord: string;
    dailyDate: string;
    isSolved: boolean;
    streak: number;
    maxStreak: number;
    hasPlayedToday: boolean;
    history: Record<string, { word: string; guesses: number; result: 'won' | 'lost'; solveRank?: number | null }>;
    savedGuesses: { word: string; evaluations: any[] }[] | null;
    recordWin: (guesses: number) => Promise<void>;
    recordLoss: () => Promise<void>;
    saveProgress: (guesses: { word: string; evaluations: any[] }[]) => Promise<void>;
}

export function useDailyStats(user: UserProfile | null | undefined): DailyStatsHook {
    const { db } = useFirebase();

    // Calculate current daily values
    const today = new Date();
    const dailyDate = getDailyDateIso(today);
    const dailyWord = getDailyWord(today);

    // Derive stats from user profile
    const daily = user?.daily;
    const history = daily?.history || {};
    const todayEntry = history[dailyDate];

    const isSolved = todayEntry?.result === 'won';
    const hasPlayedToday = !!todayEntry; // Played implies either won or lost
    const streak = daily?.streak || 0;
    const maxStreak = daily?.maxStreak || 0;

    // Get saved state if it belongs to today
    const savedGuesses = (daily?.gameState?.date === dailyDate) ? daily.gameState.guesses : null;

    const saveProgress = async (guesses: { word: string; evaluations: any[] }[]) => {
        if (!db || !user) return;
        const userRef = doc(db, 'profiles', user.uid);
        await updateDoc(userRef, {
            'daily.gameState': {
                date: dailyDate,
                guesses
            }
        });
    };

    const recordWin = async (guesses: number) => {
        if (!db || !user) return;

        const userRef = doc(db, 'profiles', user.uid);
        const newStreak = (daily?.lastSolvedDate === getDailyDateIso(new Date(Date.now() - 86400000)))
            ? (daily?.streak || 0) + 1
            : 1;

        const newMaxStreak = Math.max(newStreak, daily?.maxStreak || 0);

        // Get the solve rank from the API (atomic increment)
        let solveRank: number | null = null;
        try {
            const res = await fetch('/api/stats/record-solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid, date: dailyDate })
            });
            if (res.ok) {
                const data = await res.json();
                solveRank = data.rank;
            }
        } catch (e) {
            console.warn('Failed to get solve rank', e);
        }

        await updateDoc(userRef, {
            'daily.lastSolvedDate': dailyDate,
            'daily.streak': newStreak,
            'daily.maxStreak': newMaxStreak,
            [`daily.history.${dailyDate}`]: {
                word: dailyWord,
                guesses,
                result: 'won',
                solveRank: solveRank
            }
        });
    };

    const recordLoss = async () => {
        if (!db || !user) return;
        const userRef = doc(db, 'profiles', user.uid);

        // Streak resets on loss? Typically yes in Wordle.
        // But wait, Wordle streaks reset if you *miss* a day, or if you lose?
        // NYT Wordle resets streak to 0 on a loss.

        await updateDoc(userRef, {
            'daily.lastSolvedDate': dailyDate, // Still mark as played/solved(attempted) logic?
            // Actually strictly speaking, lastSolved means WON. 
            // If lost, streak resets to 0.
            'daily.streak': 0,
            [`daily.history.${dailyDate}`]: {
                word: dailyWord,
                guesses: 6, // max guesses
                result: 'lost'
            }
        });
    };

    return {
        dailyWord,
        dailyDate,
        isSolved,
        streak,
        maxStreak,
        hasPlayedToday,
        history,
        recordWin,
        recordLoss,
        savedGuesses,
        saveProgress
    };
}

