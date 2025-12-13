'use server';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

/**
 * API endpoint to get the count of users who have solved today's daily puzzle
 */
export async function GET() {
    try {
        // Get today's date in YYYY-MM-DD format (UTC)
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        // Query profiles where dailyHistory[today].solved === true
        // Since Firestore doesn't support querying nested map fields easily,
        // we query all profiles with recent daily activity and filter client-side
        const profilesSnapshot = await adminDb
            .collection('profiles')
            .where('dailyStreak', '>', 0)
            .limit(1000)
            .get();

        let solvedCount = 0;

        profilesSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const dailyHistory = data.dailyHistory;

            if (dailyHistory && typeof dailyHistory === 'object') {
                const todayEntry = dailyHistory[todayStr];
                if (todayEntry && todayEntry.solved === true) {
                    solvedCount += 1;
                }
            }
        });

        return NextResponse.json(
            { count: solvedCount, date: todayStr },
            { headers: { 'Cache-Control': 'public, max-age=60' } }
        );
    } catch (error) {
        console.error('Failed to fetch daily solver count', error);
        return NextResponse.json({ error: 'Unable to fetch count', count: 0 }, { status: 500 });
    }
}
