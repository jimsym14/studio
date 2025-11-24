'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Gamepad2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { NOTIFICATIONS_COLLECTION } from '@/lib/social/constants';
import type { NotificationItem } from '@/types/social';
import { markNotificationsRead } from '@/lib/social/notifications'; // We might need a client-side version or server action
import { cn } from '@/lib/utils';

// We need a way to mark read. Since `markNotificationsRead` is likely server-side (adminDb),
// we should probably use a server action or a client-side write if allowed.
// For now, let's assume we can write to the notification doc if the user owns it.
// Actually, looking at `notifications.ts`, it uses `adminDb`.
// So we should create a server action for marking read.

import { markNotificationReadAction } from '@/lib/actions/notifications'; // We need to create this

export function LobbyInviteToast() {
    const { user, db } = useFirebase();
    const router = useRouter();
    const [invite, setInvite] = useState<NotificationItem | null>(null);

    useEffect(() => {
        if (!user || !db) return;

        // Listen for unread game-invite notifications
        const q = query(
            collection(db, NOTIFICATIONS_COLLECTION),
            where('userId', '==', user.uid),
            where('type', '==', 'game-invite'),
            where('read', '==', false),
            orderBy('createdAt', 'desc'),
            limit(1)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const data = doc.data();
                setInvite({
                    id: doc.id,
                    type: 'game-invite',
                    payload: data.payload,
                    createdAt: data.createdAt?.toDate?.().toISOString(),
                    read: false,
                });
            } else {
                setInvite(null);
            }
        });

        return () => unsubscribe();
    }, [user, db]);

    const handleAccept = async () => {
        if (!invite || !invite.payload?.lobbyId || !user) return;

        const authToken = await user.getIdToken();
        // Mark read
        await markNotificationReadAction(invite.id, authToken);

        // Join lobby
        const lobbyId = invite.payload.lobbyId as string;
        const passcode = invite.payload.passcode as string | undefined;
        const url = passcode ? `/lobby/${lobbyId}?passcode=${passcode}` : `/lobby/${lobbyId}`;
        router.push(url);
        setInvite(null);
    };

    const handleDismiss = async () => {
        if (!invite || !user) return;
        const authToken = await user.getIdToken();
        await markNotificationReadAction(invite.id, authToken);
        setInvite(null);
    };

    return (
        <AnimatePresence>
            {invite && (
                <motion.div
                    initial={{ opacity: 0, y: -100 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -100 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="fixed top-4 left-0 right-0 z-50 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-4 shadow-2xl backdrop-blur-xl sm:top-6"
                >
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg">
                            <Gamepad2 className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1 pt-1">
                            <p className="text-sm font-bold uppercase tracking-wider text-emerald-400">Game Invite</p>
                            <p className="mt-1 text-base font-medium text-white">
                                <span className="font-bold text-white">{invite.payload?.fromDisplayName as string || 'A friend'}</span> invited you to play!
                            </p>
                            {invite.payload?.gameType && (
                                <p className="text-xs text-white/60 mt-1 capitalize">{invite.payload.gameType as string} Mode</p>
                            )}
                        </div>
                    </div>
                    <div className="mt-4 flex gap-3">
                        <Button
                            onClick={handleDismiss}
                            variant="ghost"
                            className="flex-1 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                        >
                            <X className="mr-2 h-4 w-4" />
                            Dismiss
                        </Button>
                        <Button
                            onClick={handleAccept}
                            className="flex-1 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Accept
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
