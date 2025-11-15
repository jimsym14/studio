import wordsData from '../../words.json';
import type { GuessScore } from './wordle';

type WordLength = number;

type WordsJson = Record<string, string[]>;

const normalizedCache = new Map<WordLength, string[]>();

const wordsJson = wordsData as WordsJson;

function getList(length: WordLength): string[] {
	if (!normalizedCache.has(length)) {
		const listFromJson = wordsJson[String(length)] ?? [];
		const cleaned = listFromJson.map((word) => word.toLowerCase());
		normalizedCache.set(length, cleaned);
	}

	return normalizedCache.get(length) ?? [];
}

export function getRandomWord(length: WordLength): string {
	const list = getList(length);
	if (!list.length) {
		throw new Error(`No words available for length ${length}`);
	}

	const index = Math.floor(Math.random() * list.length);
	return list[index];
}

export function isValidWord(word: string, length: WordLength): boolean {
	if (!word || word.length !== length) {
		return false;
	}

	const normalized = word.toLowerCase();
	const list = getList(length);
	return list.includes(normalized);
}

export function getWordCount(length: WordLength): number {
	return getList(length).length;
}

export function normalizeWord(word: string): string {
	return word.trim().toLowerCase();
}

