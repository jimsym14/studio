'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/logo';

export default function GamePage() {
  const params = useParams();
  const gameId = params.gameId as string;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
       <div className="absolute top-8">
        <Logo />
      </div>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-center">Game Screen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center">Game in progress...</p>
          <p className="text-center text-sm text-muted-foreground mt-2">Game ID: {gameId}</p>
          {/* Game grid and input will go here */}
        </CardContent>
      </Card>
    </div>
  );
}
