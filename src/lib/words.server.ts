import wordsData from '../../words.json';
import fourAnswers from '../../4_answers.json';
import fourValid from '../../4_valid.json';
import sixAnswers from '../../6_answers.json';
import sixValid from '../../6_valid.json';
import type { GuessScore } from './wordle';

type WordLength = number;

type WordsJson = Record<string, string[]>;

// Cache for answer words (used for solution selection)
const answersCache = new Map<WordLength, string[]>();

// Cache for all valid words (used for guess validation)
const validCache = new Map<WordLength, string[]>();

const wordsJson = wordsData as WordsJson;
const fourAnswersJson = fourAnswers as WordsJson;
const fourValidJson = fourValid as WordsJson;
const sixAnswersJson = sixAnswers as WordsJson;
const sixValidJson = sixValid as WordsJson;

/**
 * Get list of answer words for a given word length.
 * These are the words that can be chosen as solutions.
 */
function getAnswersList(length: WordLength): string[] {
	if (!answersCache.has(length)) {
		let answers: string[] = [];
		if (length === 4) {
			answers = fourAnswersJson['4'] ?? [];
		} else if (length === 6) {
			answers = sixAnswersJson['6'] ?? [];
		} else {
			// 5-letter words use the existing combined list
			answers = wordsJson[String(length)] ?? [];
		}
		const cleaned = answers.map((word) => word.toLowerCase());
		answersCache.set(length, cleaned);
	}

	return answersCache.get(length) ?? [];
}

/**
 * Get list of all valid guessable words for a given word length.
 * This includes answer words plus additional valid words.
 */
function getValidList(length: WordLength): string[] {
	if (!validCache.has(length)) {
		let allWords: string[] = [];
		if (length === 4) {
			const answers = fourAnswersJson['4'] ?? [];
			const valid = fourValidJson['4'] ?? [];
			allWords = [...answers, ...valid];
		} else if (length === 6) {
			const answers = sixAnswersJson['6'] ?? [];
			const valid = sixValidJson['6'] ?? [];
			allWords = [...answers, ...valid];
		} else {
			// 5-letter words use the existing combined list
			allWords = wordsJson[String(length)] ?? [];
		}
		// Deduplicate and normalize
		const normalized = [...new Set(allWords.map((word) => word.toLowerCase()))];
		validCache.set(length, normalized);
	}

	return validCache.get(length) ?? [];
}

export function getRandomWord(length: WordLength): string {
	const list = getAnswersList(length);
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
	const list = getValidList(length);
	return list.includes(normalized);
}

export function getWordCount(length: WordLength): number {
	return getValidList(length).length;
}

export function normalizeWord(word: string): string {
	return word.trim().toLowerCase();
}


export function getWordByIndex(index: number, length: WordLength): string {
	const list = getAnswersList(length);
	if (!list.length) {
		throw new Error(`No words available for length ${length}`);
	}
	// Use modulo to ensure index is valid
	const safeIndex = ((index % list.length) + list.length) % list.length;
	return list[safeIndex];
}
