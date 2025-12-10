import type { GuessResult } from '@/lib/wordle';

export type GameStatus = 'waiting' | 'in_progress' | 'completed';
export type LobbyVisibility = 'public' | 'private';

export interface GameDocument {
  id?: string;
  creatorId: string;
  creatorDisplayName?: string | null;
  gameType: 'solo' | 'multiplayer' | null;
  multiplayerMode?: 'pvp' | 'co-op' | null;
  visibility: LobbyVisibility;
  hasPasscode: boolean;
  passcode?: string | null;
  passcodeHash: string | null;
  status: GameStatus;
  players: string[];
  activePlayers: string[];
  playerAliases?: Record<string, string>;
  turnOrder?: string[];
  currentTurnPlayerId?: string | null;
  wordLength: number;
  solution: string;
  maxAttempts: number;
  guesses: GuessResult[];
  winnerId: string | null;
  endVotes: string[];
  completionMessage: string | null;
  endedBy?: string | null;
  lobbyClosesAt: string | null;
  lastActivityAt: string;
  inactivityClosesAt: string | null;
  matchHardStopAt: string | null;
  matchDeadline: string | null;
  turnDeadline: string | null;
  createdAt: string;
  completedAt: string | null;
  matchTime: string;
  turnTime?: string;
  matchState?: GameMatchState;
  roundsSetting?: number; // 1, 3, 5
  solutions?: string[]; // Pre-generated words for all rounds
  // Voting
  nextRoundVotes?: string[];
  rematchVotes?: string[];
  rematchGameId?: string;
}

export interface GameMatchState {
  currentRound: number;
  scores: Record<string, number>; // { [userId]: wins }
  draws: number;
  maxWins: number; // 2
  maxDraws: number; // 3
  isMatchOver: boolean;
  matchWinnerId?: string | null;
  roundBonus?: {
    beneficiaryId: string;
    revealedLetter: string;
    revealedLetterIndex: number;
  };
}
