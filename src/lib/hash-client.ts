export async function hashToHex(value: string): Promise<string> {
  const cryptoSource = globalThis.crypto;
  if (!cryptoSource?.subtle) {
    throw new Error('Secure hashing is unavailable in this environment.');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await cryptoSource.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
