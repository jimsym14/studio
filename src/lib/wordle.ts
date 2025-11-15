export type GuessScore = 'correct' | 'present' | 'absent';

export interface GuessResult {
  word: string;
  evaluations: GuessScore[];
  playerId: string;
  submittedAt: string;
}

export function scoreGuess(guess: string, solution: string): GuessScore[] {
  if (guess.length !== solution.length) {
    throw new Error('Guess length does not match solution length');
  }

  const length = guess.length;
  const result: GuessScore[] = Array(length).fill('absent');
  const solutionChars = solution.split('');
  const guessChars = guess.split('');
  const remaining: Record<string, number> = {};

  for (let i = 0; i < length; i++) {
    if (guessChars[i] === solutionChars[i]) {
      result[i] = 'correct';
    } else {
      const char = solutionChars[i];
      remaining[char] = (remaining[char] ?? 0) + 1;
    }
  }

  for (let i = 0; i < length; i++) {
    if (result[i] === 'correct') continue;
    const char = guessChars[i];
    if (remaining[char]) {
      result[i] = 'present';
      remaining[char] -= 1;
    }
  }

  return result;
}

export function getKeyboardHints(guesses: GuessResult[]): Record<string, GuessScore> {
  const hints: Record<string, GuessScore> = {};

  for (const guess of guesses) {
    guess.word.split('').forEach((char, index) => {
      const score = guess.evaluations[index];
      const existing = hints[char];

      if (!existing || rank(score) > rank(existing)) {
        hints[char] = score;
      }
    });
  }

  return hints;
}

function rank(score: GuessScore): number {
  switch (score) {
    case 'correct':
      return 3;
    case 'present':
      return 2;
    default:
      return 1;
  }
}
