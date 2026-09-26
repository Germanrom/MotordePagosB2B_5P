import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

const decodeKey = (key: string): Buffer => {
  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key');
  return decoded;
};

export const encryptSecret = (plaintext: string, key: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
};

export const decryptSecret = (stored: string, key: string): string => {
  if (!stored.startsWith(PREFIX)) return stored; // Transitional compatibility until the credential backfill runs.
  const [ivEncoded, tagEncoded, ciphertextEncoded] = stored.slice(PREFIX.length).split(':');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('Encrypted credential has an invalid format');
  const decipher = createDecipheriv('aes-256-gcm', decodeKey(key), Buffer.from(ivEncoded, 'base64'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64')), decipher.final()]).toString('utf8');
};

export const encryptConfiguredSecret = (plaintext: string): string => {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is required to access provider credentials');
  return encryptSecret(plaintext, key);
};

export const decryptConfiguredSecret = (stored: string): string => {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is required to access provider credentials');
  return decryptSecret(stored, key);
};
