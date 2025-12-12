
import { getWordByIndex } from './words.server';

// Use a fixed epoch for consistent day calculation
const EPOCH_MS = new Date('2024-01-01T00:00:00Z').getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getDailyDateIso(date: Date = new Date()): string {
    // Global word uses UTC date strictly
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function getDailyWord(date: Date = new Date()): string {
    const nowMs = date.getTime();
    const daysSinceEpoch = Math.floor((nowMs - EPOCH_MS) / MS_PER_DAY);

    // Create a seeded random number from the day index
    const seed = daysSinceEpoch;

    // Simple LCG
    let t = seed + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const randomInt = ((t ^ (t >>> 14)) >>> 0);

    // Use the deterministic random int as the index
    return getWordByIndex(randomInt, 5);
}
