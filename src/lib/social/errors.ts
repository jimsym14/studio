import { NextResponse } from 'next/server';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, options?: { code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export const handleApiError = (error: unknown) => {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code ?? 'api_error',
        details: error.details ?? null,
      },
      { status: error.status }
    );
  }

  console.error('Unexpected API error', error);
  return NextResponse.json({ error: 'Unexpected server error', code: 'server_error' }, { status: 500 });
};
