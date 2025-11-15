import { NextResponse } from 'next/server';
import { isValidWord, normalizeWord } from '@/lib/words.server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const word = typeof body.word === 'string' ? body.word : '';
  const length = typeof body.length === 'number' ? body.length : 5;

  const normalized = normalizeWord(word);
  const valid = isValidWord(normalized, length);

  return NextResponse.json({ valid, word: normalized, length });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const word = searchParams.get('word') ?? '';
  const lengthParam = searchParams.get('length');
  const length = lengthParam ? Number(lengthParam) : 5;

  const normalized = normalizeWord(word);
  const valid = isValidWord(normalized, Number.isNaN(length) ? 5 : length);

  return NextResponse.json({ valid, word: normalized, length });
}
