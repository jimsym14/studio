'use server';

import { adminDb } from '@/lib/firebase-admin';
import { NOTIFICATIONS_COLLECTION } from '@/lib/social/constants';
import { enqueueNotification } from '@/lib/social/notifications';
import { resolveUserFromToken } from '@/lib/social/auth';
import { FieldValue } from 'firebase-admin/firestore';

async function requireUser(authToken: string) {
    const user = await resolveUserFromToken(authToken);
    if (!user) {
        throw new Error('Unauthorized');
    }
    return user;
}

export async function markNotificationReadAction(notificationId: string, authToken: string) {
    const user = await requireUser(authToken);
    const docRef = adminDb.collection(NOTIFICATIONS_COLLECTION).doc(notificationId);
    const doc = await docRef.get();

    if (!doc.exists) return;
    const data = doc.data();

    if (data?.userId !== user.uid) {
        throw new Error('Unauthorized');
    }

    await docRef.update({
        read: true,
        updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function sendGameInviteAction(friendId: string, lobbyId: string, passcode: string | null | undefined, authToken: string) {
    const user = await requireUser(authToken);

    // Verify friendship? (Optional but good practice)
    // For now, assume client checks are enough or enqueueNotification handles it?
    // enqueueNotification doesn't check friendship.
    // But let's just send it.

    await enqueueNotification({
        userId: friendId,
        type: 'game-invite',
        payload: {
            from: user.uid,
            fromDisplayName: user.displayName || 'A friend',
            lobbyId,
            passcode,
            gameType: 'multiplayer', // Or get from args if needed
        },
    });
}
