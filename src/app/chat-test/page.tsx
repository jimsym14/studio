'use client';

import { useState, useEffect } from 'react';
import { ChatDock } from '@/components/chat-dock';
import type { ChatContextDescriptor, ChatAvailability } from '@/types/social';
import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

/**
 * Chat Test Page - Utility to test chat functionality easily
 * 
 * This page allows testing chat in different scenarios:
 * 1. Game chat - simulates a multiplayer game chat
 * 2. Lobby chat - simulates a lobby chat
 * 
 * Usage: Navigate to /chat-test after logging in
 */
export default function ChatTestPage() {
    const { userId, user, profile } = useFirebase();
    const [testGameId, setTestGameId] = useState('test-game-123');
    const [testLobbyId, setTestLobbyId] = useState('test-lobby-456');
    const [activeTest, setActiveTest] = useState<'game' | 'lobby' | null>(null);

    const isGuest = !user || profile?.accountType === 'guest';
    const chatAvailability: ChatAvailability = isGuest ? 'guest-blocked' : 'persistent';

    const gameChatContext: ChatContextDescriptor = {
        scope: 'game',
        gameId: testGameId,
        gameName: `Test Game ${testGameId}`,
    };

    const lobbyChatContext: ChatContextDescriptor = {
        scope: 'lobby',
        lobbyId: testLobbyId,
        lobbyName: `Test Lobby ${testLobbyId}`,
    };

    const testParticipants = [
        {
            id: userId || 'user-1',
            displayName: profile?.username || 'You',
            photoURL: profile?.photoURL || null,
            isSelf: true,
        },
        {
            id: 'test-user-2',
            displayName: 'Test Player 2',
            photoURL: null,
            isSelf: false,
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <Card className="p-6 bg-white/10 backdrop-blur-xl border-white/20">
                    <h1 className="text-3xl font-bold text-white mb-2">Chat Test Utility</h1>
                    <p className="text-white/70">Test chat functionality in different scenarios</p>
                </Card>

                <Card className="p-6 bg-white/10 backdrop-blur-xl border-white/20 space-y-4">
                    <div>
                        <h2 className="text-xl font-semibold text-white mb-4">User Info</h2>
                        <div className="space-y-2 text-white/80">
                            <p>User ID: {userId || 'Not logged in'}</p>
                            <p>Username: {profile?.username || 'N/A'}</p>
                            <p>Account Type: {isGuest ? 'Guest' : 'Registered'}</p>
                            <p>Chat Availability: {chatAvailability}</p>
                        </div>
                    </div>

                    {isGuest && (
                        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                            <p className="text-red-200 text-sm">
                                ⚠️ You are logged in as a guest. Please sign in with a real account to test chat functionality.
                            </p>
                        </div>
                    )}
                </Card>

                <Card className="p-6 bg-white/10 backdrop-blur-xl border-white/20 space-y-4">
                    <div>
                        <h2 className="text-xl font-semibold text-white mb-4">Test Scenarios</h2>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-white text-sm font-medium">Game ID:</label>
                                <Input
                                    value={testGameId}
                                    onChange={(e) => setTestGameId(e.target.value)}
                                    placeholder="Enter game ID"
                                    className="bg-white/5 border-white/20 text-white"
                                />
                                <Button
                                    onClick={() => setActiveTest('game')}
                                    disabled={!testGameId || isGuest}
                                    className="w-full"
                                >
                                    Test Game Chat
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <label className="text-white text-sm font-medium">Lobby ID:</label>
                                <Input
                                    value={testLobbyId}
                                    onChange={(e) => setTestLobbyId(e.target.value)}
                                    placeholder="Enter lobby ID"
                                    className="bg-white/5 border-white/20 text-white"
                                />
                                <Button
                                    onClick={() => setActiveTest('lobby')}
                                    disabled={!testLobbyId || isGuest}
                                    className="w-full"
                                >
                                    Test Lobby Chat
                                </Button>
                            </div>

                            {activeTest && (
                                <Button
                                    onClick={() => setActiveTest(null)}
                                    variant="outline"
                                    className="w-full"
                                >
                                    Clear Active Test
                                </Button>
                            )}
                        </div>
                    </div>
                </Card>

                {activeTest && (
                    <Card className="p-6 bg-white/10 backdrop-blur-xl border-white/20">
                        <h3 className="text-lg font-semibold text-white mb-2">
                            Active Test: {activeTest === 'game' ? 'Game Chat' : 'Lobby Chat'}
                        </h3>
                        <p className="text-white/70 text-sm mb-4">
                            Chat dock should appear in the bottom right corner. Check browser console for errors.
                        </p>
                        <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
                            <p className="text-blue-200 text-sm">
                                💡 <strong>Testing Tips:</strong>
                            </p>
                            <ul className="text-blue-200 text-sm mt-2 space-y-1 list-disc list-inside">
                                <li>Open browser DevTools (F12) and check Console tab</li>
                                <li>Open another browser window/tab in incognito mode with a different account</li>
                                <li>Use the same {activeTest === 'game' ? 'Game' : 'Lobby'} ID in both windows</li>
                                <li>Try sending messages between the two accounts</li>
                                <li>Check for connection errors or loops in the console</li>
                            </ul>
                        </div>
                    </Card>
                )}

                {activeTest === 'game' && !isGuest && (
                    <ChatDock
                        context={gameChatContext}
                        availability={chatAvailability}
                        participantCount={2}
                        participants={testParticipants}
                    />
                )}

                {activeTest === 'lobby' && !isGuest && (
                    <ChatDock
                        context={lobbyChatContext}
                        availability={chatAvailability}
                        participantCount={2}
                        participants={testParticipants}
                    />
                )}
            </div>
        </div>
    );
}
