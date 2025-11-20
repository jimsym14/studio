import { FirebaseError } from 'firebase/app';

const RETRYABLE_CODES = new Set(['aborted', 'failed-precondition', 'unavailable']);

type RetryOptions = {
  retries?: number;
  delayMs?: number;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runWithFirestoreRetry<T>(operation: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const retries = Math.max(0, options?.retries ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 75);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        error instanceof FirebaseError &&
        RETRYABLE_CODES.has(error.code) &&
        attempt < retries;

      if (!shouldRetry) {
        throw error;
      }

      await wait(delayMs * (attempt + 1));
    }
  }

  throw new Error('runWithFirestoreRetry exhausted retries');
}
