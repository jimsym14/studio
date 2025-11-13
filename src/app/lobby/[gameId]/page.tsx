'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';
import { Copy, Check } from 'lucide-react';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalStorage } from '@/hooks/use-local-storage';

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const { db } = useFirebase();
  const { toast } = useToast();
  const [userId] = useLocalStorage('wordmates-userId', '');

  const [game, setGame] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const gameId = params.gameId as string;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setInviteLink(window.location.href);
    }
  }, []);

  useEffect(() => {
    if (!gameId || !userId || !db) return;

    const gameRef = doc(db, 'games', gameId);

    const unsubscribe = onSnapshot(gameRef, async (docSnap) => {
      if (docSnap.exists()) {
        const gameData = docSnap.data();
        setGame(gameData);

        const isPlayer = gameData.players.includes(userId);

        // If user is not in the game and game is waiting, join
        if (!isPlayer && gameData.status === 'waiting' && gameData.players.length < 2) {
          await updateDoc(gameRef, {
            players: arrayUnion(userId),
          });
        }
        
        // If 2 players have joined, start the game
        if (gameData.players.length === 2 && gameData.status === 'waiting') {
           await updateDoc(gameRef, {
            status: 'in_progress',
          });
          toast({ title: "Player joined!", description: "The game is starting." });
        }


        if (gameData.status === 'in_progress') {
          router.push(`/game/${gameId}`);
        }
        setLoading(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Game not found.',
        });
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [gameId, userId, router, toast, db]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(inviteLink);
    setIsCopied(true);
    toast({ title: "Copied to clipboard!" });
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (loading) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-md animate-pulse">
                <CardHeader className="text-center">
                    <Skeleton className="h-8 w-48 mx-auto" />
                    <Skeleton className="h-4 w-64 mx-auto mt-2" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="text-center space-y-2">
                        <Skeleton className="h-6 w-32 mx-auto" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="text-center text-sm text-muted-foreground space-y-2">
                        <Skeleton className="h-4 w-16 mx-auto" />
                        <Skeleton className="h-8 w-24 mx-auto" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="absolute top-8">
        <Logo />
      </div>
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-3xl">Lobby</CardTitle>
          <CardDescription>Waiting for players to join...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Share this link to invite others:</p>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="w-full px-3 py-2 text-sm border rounded-md bg-muted text-muted-foreground"
              />
              <Button size="icon" onClick={copyToClipboard}>
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div>
              <p className="text-sm font-medium text-muted-foreground">Players in lobby</p>
              <p className="text-2xl font-bold">{game?.players?.length || 1} / 2</p>
          </div>
          <div className="flex justify-center">
            <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4 animate-spin border-t-primary"></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
