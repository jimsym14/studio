'use server';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * API endpoint to atomically increment the daily solver count and return the user's rank.
 * Called when a user solves the daily puzzle.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId, date } = body;

        if (!userId || !date) {
            return NextResponse.json({ error: 'Missing userId or date' }, { status: 400 });
        }

        // Use a transaction to atomically increment and get the count
        const dailyStatsRef = adminDb.collection('dailyStats').doc(date);

        const result = await adminDb.runTransaction(async (transaction) => {
            const doc = await transaction.get(dailyStatsRef);

            let currentCount = 0;
            if (doc.exists) {
                currentCount = doc.data()?.solverCount || 0;
            }

            const newCount = currentCount + 1;

            // Update or create the document with the new count
            transaction.set(dailyStatsRef, {
                solverCount: newCount,
                lastUpdated: FieldValue.serverTimestamp()
            }, { merge: true });

            return newCount; // This is the user's rank (they are the Nth solver)
        });

        return NextResponse.json({
            rank: result,
            date
        });
    } catch (error) {
        console.error('Failed to record solver', error);
        return NextResponse.json({ error: 'Unable to record solver', rank: null }, { status: 500 });
    }
}
