import { createHash, createHmac } from 'node:crypto';

export const hashApiKey = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex');

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const canonicalJson = canonicalize;

export const fingerprintRequest = (value: unknown): string =>
  createHash('sha256').update(canonicalize(value)).digest('hex');

export const hashCallbackSignature = (payload: unknown, secret: string): string =>
  createHmac('sha256', secret).update(canonicalize(payload)).digest('hex');
