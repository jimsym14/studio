export const usernameRegex = /^[a-zA-Z0-9._-]{3,20}$/;

export const sanitizeUsername = (value: string) => value.trim();

export const usernameToLower = (value: string) => sanitizeUsername(value).toLowerCase();

export const isUsernameValid = (value: string) => usernameRegex.test(sanitizeUsername(value));
