// Типы для bootstrap/pick.js (его же использует загрузчик на чистом JS).
export function cmpVersion(a: string, b: string): number;
export interface CodeMeta { version: string; shell: number; size: number; sha512: string; sig?: string; notes?: string; gz?: string; gzSize?: number }
export function signMeta(meta: CodeMeta, privateKeyPem: string | Buffer): string;
export function verifyMeta(meta: unknown, publicKeyPem: string): boolean;
export function sha512(buf: Uint8Array): string;
export function order<T extends { version: string; shell: number; source: string; signed?: boolean }>(c: T[], shell: number, bad: string[]): T[];
export const MAX_ATTEMPTS: number;
