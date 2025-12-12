'use server';

import { createHash } from 'crypto';
import type { FirebaseOptions } from 'firebase/app';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getRandomWord, normalizeWord } from '@/lib/words.server';

// A simple random ID generator
function generateGameId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function parseMinutes(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== 'unlimited') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addMinutes(baseIso: string, minutes: number | null): string | null {
  if (!minutes) return null;
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

function parseSeconds(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== 'unlimited') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addSeconds(baseIso: string, seconds: number | null): string | null {
  if (!seconds) return null;
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + seconds * 1000).toISOString();
}

const shouldUseEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
const WAITING_MINUTES = 10;
const MATCH_HARD_STOP_MINUTES = 30;

const requiredFirebaseKeys: Array<keyof FirebaseOptions> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const cleanEnvValue = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // ignore decode errors
  }
  normalized = normalized
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '')
    .replace(/\s+/g, '');
  return normalized || undefined;
};

const resolveFirebaseConfig = (incoming: FirebaseOptions): FirebaseOptions => {
  const fallbackEnv = {
    apiKey: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  } satisfies FirebaseOptions;

  const resolvedConfig: FirebaseOptions = {
    ...fallbackEnv,
    ...incoming,
  };

  const missingKeys = requiredFirebaseKeys.filter((key) => !resolvedConfig[key]);
  if (missingKeys.length) {
    throw new Error(`Firebase config is missing: ${missingKeys.join(', ')}`);
  }

  return resolvedConfig;
};

const hashPasscode = (value: string) => createHash('sha256').update(value).digest('hex');

const normalizeVisibility = (value: unknown): 'public' | 'private' =>
  value === 'private' ? 'private' : 'public';

export async function createGame(
  settings: any,
  firebaseConfig: FirebaseOptions,
  authToken?: string
) {
  const {
    creatorId,
    creatorDisplayName: incomingCreatorDisplayName,
    visibility: incomingVisibility,
    passcode: incomingPasscode,
    ...gameSettings
  } = settings ?? {};

  if (!creatorId) {
    throw new Error("Creator ID is missing. The client must provide the user's UID.");
  }

  if (!firebaseConfig?.apiKey) {
    throw new Error('Firebase config is missing.');
  }

  try {
    const resolvedConfig = resolveFirebaseConfig(firebaseConfig);
    if (!process.env.FIREBASE_ADMIN_PROJECT_ID && resolvedConfig.projectId) {
      process.env.FIREBASE_ADMIN_PROJECT_ID = resolvedConfig.projectId;
    }

    let verifiedUid: string | null = null;
    if (authToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(authToken);
        verifiedUid = decoded.uid;
      } catch (authError) {
        if (!shouldUseEmulators) {
          throw new Error('Failed to verify auth token.');
        }
      }
    }

    if (!verifiedUid && !shouldUseEmulators) {
      throw new Error('Auth token required to create a game.');
    }

    if (verifiedUid && verifiedUid !== creatorId) {
      throw new Error('Creator ID mismatch with authenticated user.');
    }

    const lobbyVisibility = normalizeVisibility(incomingVisibility);
    const normalizedPasscode = typeof incomingPasscode === 'string' ? incomingPasscode.trim() : '';

    if (lobbyVisibility === 'private' && !normalizedPasscode) {
      throw new Error('Private lobbies require a passcode.');
    }

    const passcodeHash = lobbyVisibility === 'private' ? hashPasscode(normalizedPasscode) : null;
    const creatorDisplayName = typeof incomingCreatorDisplayName === 'string'
      ? incomingCreatorDisplayName.trim()
      : '';
    const hasPasscode = Boolean(passcodeHash);

    const gameId = generateGameId();

    const wordLength = typeof gameSettings.wordLength === 'number' ? gameSettings.wordLength : 5;
    const normalizedLength = Math.max(4, Math.min(6, wordLength));
    const roundsSetting = typeof gameSettings.roundsSetting === 'number' ? gameSettings.roundsSetting : 1;
    const maxWins = Math.ceil(roundsSetting / 2);
    const maxDraws = roundsSetting;

    // Generate N unique solutions
    const solutions: string[] = [];
    while (solutions.length < roundsSetting) {
      const candidate = normalizeWord(getRandomWord(normalizedLength));
      if (!solutions.includes(candidate)) {
        solutions.push(candidate);
      }
    }
    const solution = solutions[0];
    const maxAttempts = 6;

    const createdAt = new Date().toISOString();
    const initialStatus = gameSettings.gameType === 'multiplayer' ? 'waiting' : 'in_progress';
    const roundMinutes = parseMinutes(gameSettings.matchTime);
    const chessSeconds = parseSeconds(gameSettings.turnTime);

    // Initial Round Deadline (formerly Match Deadline, now per round)
    // Initial Round Deadline (Paused at start)
    const currentRoundDeadline = null;

    // Initial Chess Timers (Bank per player)
    // If chessSeconds is set, every player starts with that many seconds.
    // If unlimited, it's null.
    const initialPlayerTimers: Record<string, number | null> = {};
    if (chessSeconds) {
      // Only Creator is in players initially
      initialPlayerTimers[creatorId] = chessSeconds;
    }

    const initialHardStop = initialStatus === 'in_progress'
      ? addMinutes(createdAt, MATCH_HARD_STOP_MINUTES)
      : null;

    const matchState = {
      currentRound: 1,
      scores: {},
      draws: 0,
      maxWins,
      maxDraws,
      isMatchOver: false,
      matchWinnerId: null,
      roundBonus: null,
      // We store the computed deadlines/timers in matchState or root?
      // Root is better for "current round state", but matchState tracks the match.
      // Let's put round-specifics in game root as they reset every round.
    };

    const initialGameData = {
      ...gameSettings,
      roundsSetting,
      solutions,
      wordLength: normalizedLength,
      creatorId,
      creatorDisplayName: creatorDisplayName || null,
      visibility: lobbyVisibility,
      hasPasscode,
      passcode: lobbyVisibility === 'private' ? normalizedPasscode : null,
      passcodeHash,
      status: initialStatus,
      players: [creatorId],
      activePlayers: [creatorId],
      playerAliases: creatorDisplayName ? { [creatorId]: creatorDisplayName } : {},
      turnOrder: [],
      currentTurnPlayerId: null,
      createdAt,
      solution,
      maxAttempts,
      guesses: [],
      winnerId: null,
      endVotes: [],
      completionMessage: null,
      endedBy: null,
      lobbyClosesAt: null,
      lastActivityAt: createdAt,
      inactivityClosesAt: initialStatus === 'waiting' ? addMinutes(createdAt, WAITING_MINUTES) : null,
      matchHardStopAt: initialHardStop,

      // Timer Fields
      roundDeadline: currentRoundDeadline, // Replaces matchDeadline
      roundTimeLimit: roundMinutes,        // Store limit for resets
      chessTimeLimit: chessSeconds,        // Store limit for resets
      playerTimers: initialPlayerTimers,   // Store current banks
      turnStartedAt: null, // Paused until first move

      turnDeadline: null, // Deprecated/Unused for Chess Clock logic
      completedAt: null,
      matchState,
    };

    await adminDb.collection('games').doc(gameId).set(initialGameData);

    return gameId;
  } catch (error) {
    console.error("Error creating game:", error);
    return null;
  }
}

export async function advanceGameRound(
  gameId: string,
  previousWinnerId: string | null, // null implies a draw for this round
  expectedCurrentRound: number,   // guard against race conditions
  authToken?: string
) {
  if (!gameId) throw new Error('Game ID is required');

  // Verify Auth (Server Acton)
  let verifiedUid: string | null = null;
  if (authToken) {
    try {
      const decoded = await adminAuth.verifyIdToken(authToken);
      verifiedUid = decoded.uid;
    } catch {
      if (!shouldUseEmulators) throw new Error('Unauthorized');
    }
  }

  // Get current game state
  const gameRef = adminDb.collection('games').doc(gameId);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) throw new Error('Game not found');

  const gameData = gameSnap.data() as any;
  const matchState = gameData.matchState || {
    currentRound: 1,
    scores: {},
    draws: 0,
    maxWins: 2,
    maxDraws: 3,
    isMatchOver: false,
    matchWinnerId: null,
  };

  // Prevent double-advancement race conditions
  if (matchState.currentRound !== expectedCurrentRound) {
    console.warn(`Race condition prevented: Attempted to advance from ${expectedCurrentRound}, but game is already at ${matchState.currentRound}`);
    return { success: false, message: 'Round already advanced', isMatchOver: matchState.isMatchOver };
  }

  if (matchState.isMatchOver) {
    return { success: false, message: 'Match is already over' };
  }

  // --- Update Scores ---
  const scores = { ...matchState.scores };
  let draws = matchState.draws;

  if (previousWinnerId) {
    scores[previousWinnerId] = (scores[previousWinnerId] || 0) + 1;
  } else {
    draws += 1;
  }

  // --- Check Match Outcomes ---
  // Removed redundant loop check here to fix variable shadowing
  // Logic continues below...

  // Check for draws limit (if draws >= 3)
  const nextRound = matchState.currentRound + 1;
  const isMatchWin = Object.values(scores).some((score) => typeof score === 'number' && score >= matchState.maxWins);
  const isMatchDraw = draws >= matchState.maxDraws;
  const isMatchOver = isMatchWin || isMatchDraw; // Or if nextRound > max possible rounds? 
  // Max rounds = maxWins * 2 - 1. E.g. Best of 3 (2 wins) -> Max 3 rounds.
  // If we played 3 rounds and no one has 2 wins? (e.g. 1-0 and 2 draws -> 1-0 score. Player 1 wins?)
  // User said: "at the end based on score calculate winner".
  // So if rounds exhausted (currentRound > roundsSetting?), check scores.

  const roundsSetting = gameData.roundsSetting || 1; // Default back to 1 if missing
  const roundsExhausted = nextRound > roundsSetting;

  const finalMatchOver = isMatchOver || roundsExhausted;

  if (finalMatchOver) {
    // Match End Logic
    let matchWinnerId = null;
    if (isMatchWin) {
      matchWinnerId = Object.entries(scores).find(([_, score]) => (score as number) >= matchState.maxWins)?.[0] ?? null;
    } else if (roundsExhausted) {
      // Compare scores
      const sorted = Object.entries(scores).sort(([, a], [, b]) => (b as number) - (a as number));
      if (sorted.length && (sorted[0][1] as number) > ((sorted[1]?.[1] as number) || 0)) {
        matchWinnerId = sorted[0][0];
      }
    }

    await gameRef.update({
      'matchState.scores': scores, // Update scores before ending
      'matchState.draws': draws,   // Update draws before ending
      'matchState.isMatchOver': true,
      'matchState.matchWinnerId': matchWinnerId,
      status: 'completed',
      completedAt: new Date().toISOString(),
      winnerId: matchWinnerId, // Set overarching winner
      completionMessage: 'Match Concluded'
    });
    return { success: true, isMatchOver: true };
  }

  // Prepare Next Round
  const solutions = gameData.solutions || [];
  // Fallback if solutions missing (legacy) -> random
  const nextSolution = solutions[nextRound - 1] || normalizeWord(getRandomWord(gameData.wordLength || 5));

  // Swap turns if there was a winner
  // Winner plays 2nd -> means currentTurnPlayerId = Loser
  // Loser = the one who isn't previousWinnerId
  let nextTurnPlayerId = gameData.currentTurnPlayerId;
  let nextTurnOrder = gameData.turnOrder || [];

  if (previousWinnerId && gameData.players && gameData.players.length === 2) {
    const loserId = gameData.players.find((p: string) => p !== previousWinnerId);
    if (loserId) {
      nextTurnPlayerId = loserId;
      // turnOrder should be [loser, winner] to rotate?
      // Actually typically array is [p1, p2].
      // If loser plays first, just set currentTurnPlayerId = loserId.
    }
  }

  // Generate Bonus for Winner
  let roundBonus = null;
  if (previousWinnerId) {
    const idx = Math.floor(Math.random() * (gameData.wordLength || 5));
    const char = nextSolution[idx];
    roundBonus = {
      beneficiaryId: previousWinnerId,
      revealedLetterIndex: idx,
      revealedLetter: char
    };
  }

  // Reset Timers for Next Round
  const roundMinutes = gameData.roundTimeLimit || null;
  // Paused at start of round:
  const nextRoundDeadline = null;

  // Reset Chess Timers
  const chessSeconds = gameData.chessTimeLimit || null;
  const nextPlayerTimers: Record<string, number | null> = {};
  if (chessSeconds && gameData.players) {
    for (const pid of gameData.players) {
      nextPlayerTimers[pid as string] = chessSeconds;
    }
  }

  await gameRef.update({
    'matchState.scores': scores, // Update scores for the current round
    'matchState.draws': draws,   // Update draws for the current round
    'matchState.currentRound': nextRound,
    'matchState.roundBonus': roundBonus,
    solution: nextSolution,
    guesses: [],
    endedBy: null,
    nextRoundVotes: [], // Clear votes
    status: 'in_progress', // CRITICAL: Reset status to restart the loop
    currentTurnPlayerId: nextTurnPlayerId,
    winnerId: null, // Clear previous winner
    completionMessage: null, // Clear completion message

    // Timers Reset
    lastActivityAt: new Date().toISOString(),
    roundDeadline: nextRoundDeadline,
    playerTimers: nextPlayerTimers,
    turnStartedAt: null, // Start fresh turn tracking (Paused)

    // Cleanup old fields
    matchDeadline: null,
    turnDeadline: null,
  });

  return { success: true, isMatchOver: false };
}

export async function toggleEndVote(
  gameId: string,
  authToken: string
) {
  if (!gameId) throw new Error('Game ID is required');

  // Verify Auth
  let userId: string;
  try {
    const decoded = await adminAuth.verifyIdToken(authToken);
    userId = decoded.uid;
  } catch {
    if (!shouldUseEmulators) throw new Error('Unauthorized');
    userId = 'emulator_user'; // Fallback if emulating
  }

  const gameRef = adminDb.collection('games').doc(gameId);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) throw new Error('Game not found');

  const gameData = gameSnap.data() as any;
  if (gameData.status === 'completed') {
    return { success: false, message: 'Match is already over' };
  }

  const currentVotes = (gameData.endVotes || []) as string[];
  const activePlayers = (gameData.activePlayers || []) as string[];

  // Toggle Vote
  let newVotes;
  if (currentVotes.includes(userId)) {
    newVotes = currentVotes.filter((id: string) => id !== userId);
  } else {
    newVotes = [...currentVotes, userId];
  }

  // Check for Unanimous Vote (among active players)
  const activeCount = activePlayers.length;
  const activeVoters = newVotes.filter((id: string) => activePlayers.includes(id));
  const isUnanimous = activeCount > 0 && activeVoters.length >= activeCount;

  if (isUnanimous) {
    await gameRef.update({
      endVotes: newVotes,
      status: 'completed',
      completedAt: new Date().toISOString(),
      winnerId: null,
      'matchState.isMatchOver': true,
      'matchState.matchWinnerId': null, // Explicit tie
      completionMessage: 'Match Ended in a Tie (Mutual Agreement)',
      endedBy: 'vote'
    });
    return { success: true, isMatchOver: true, cancelled: true };
  } else {
    await gameRef.update({
      endVotes: newVotes
    });
    return { success: true, isMatchOver: false, voted: newVotes.includes(userId) };
  }
}

export async function surrenderMatch(
  gameId: string,
  authToken: string
) {
  if (!gameId) throw new Error('Game ID is required');

  // Verify Auth
  let userId: string;
  try {
    const decoded = await adminAuth.verifyIdToken(authToken);
    userId = decoded.uid;
  } catch {
    if (!shouldUseEmulators) throw new Error('Unauthorized');
    userId = 'emulator_user';
  }

  const gameRef = adminDb.collection('games').doc(gameId);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) throw new Error('Game not found');

  const gameData = gameSnap.data() as any;
  if (gameData.status === 'completed') {
    return { success: false, message: 'Match is already over' };
  }

  // Find Winner (Anyone but me)
  const otherPlayerId = (gameData.players || []).find((p: string) => p !== userId);

  await gameRef.update({
    status: 'completed',
    completedAt: new Date().toISOString(),
    winnerId: otherPlayerId || null,
    'matchState.isMatchOver': true,
    'matchState.matchWinnerId': otherPlayerId || null,
    completionMessage: 'Match Concluded by Surrender',
    endedBy: userId
  });

  return { success: true, isMatchOver: true };
}
