export class SocialClientError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
  details?: unknown;
}

const parseJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export type SocialAuthTokenProvider = () => Promise<string | null>;

let authTokenProvider: SocialAuthTokenProvider | null = null;

export const setSocialAuthTokenProvider = (provider: SocialAuthTokenProvider | null) => {
  authTokenProvider = provider;
};

const resolveAuthHeaders = async () => {
  if (!authTokenProvider) return null;
  try {
    const token = await authTokenProvider();
    if (!token) return null;
    return new Headers({
      authorization: `Bearer ${token}`,
      'x-firebase-token': token,
    });
  } catch (error) {
    console.error('Failed to resolve social auth token', error);
    return null;
  }
};

export async function socialRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = typeof init?.body !== 'undefined';
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('authorization') && !headers.has('x-firebase-token')) {
    const authHeaders = await resolveAuthHeaders();
    authHeaders?.forEach((value, key) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }

  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers,
  });

  const data = await parseJson(response);
  if (!response.ok) {
    const payload = (data ?? {}) as ApiErrorPayload;
    throw new SocialClientError(
      response.status,
      payload.error ?? response.statusText,
      payload.code,
      payload.details
    );
  }

  return (data as T) ?? ({} as T);
}

export const socialGet = <T>(path: string) => socialRequest<T>(path, { method: 'GET' });

export const socialPost = <T>(path: string, body?: unknown) =>
  socialRequest<T>(path, {
    method: 'POST',
    body: typeof body === 'undefined' ? undefined : JSON.stringify(body),
  });
