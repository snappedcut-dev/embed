/**
 * The host ↔ frame message protocol.
 *
 * Pure, and deliberately in its own file: everything that decides whether a
 * message is trustworthy is here, so it can be tested without a browser. The
 * checks below are the security boundary — a page that can post to our frame
 * must not be able to pretend to *be* our frame.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_ORIGIN = 'https://snappedcut.com';

/** What the server renders. Which of these a session may use is its `features.formats`. */
export type ExportFormat = 'mp4' | 'webm' | 'mov' | 'mkv';

export type EmbedErrorCode =
  | 'invalid_input'
  | 'mount_failed'
  | 'token_expired'
  | 'unauthorized'
  | 'origin_not_allowed'
  | 'unsupported'
  | 'network_error'
  | 'export_failed'
  | 'credits_exhausted'
  | 'rate_limited'
  | 'internal';

export class EmbedError extends Error {
  readonly code: EmbedErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: EmbedErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EmbedError';
    this.code = code;
    this.details = details;
  }
}

/** Every message the frame may send us. Anything else is discarded. */
export const FRAME_EVENTS = [
  'ready',
  'error',
  'change',
  'export',
  'job',
  'token-expiring',
  'reply',
] as const;

export type FrameEventName = (typeof FRAME_EVENTS)[number];

export type FrameMessage = {
  readonly source: 'snappedcut';
  readonly v: number;
  readonly frameId: string;
  readonly type: FrameEventName;
  readonly id?: number;
  readonly payload?: unknown;
  readonly error?: { code: EmbedErrorCode; message: string; retryAfterMs?: number };
};

/**
 * Is this `message` event really from the frame we mounted?
 *
 * Three things must all hold, and each has a way of being wrong that looks
 * fine in a demo:
 *
 * 1. **The origin matches.** Without it any page could post to us.
 * 2. **The `source` window is the frame's own `contentWindow`.** Origin alone
 *    is not enough: a *second* iframe on the same origin, or a popup we did
 *    not open, shares it.
 * 3. **The `frameId` matches the one we issued.** Two embeds on one page share
 *    both the origin and nothing else — this is what keeps their traffic apart.
 */
export function isFrameMessage(
  event: { origin: string; source: unknown; data: unknown },
  expected: { origin: string; window: unknown; frameId: string },
): event is { origin: string; source: unknown; data: FrameMessage } {
  if (event.origin !== expected.origin) return false;
  if (event.source !== expected.window) return false;

  const data = event.data as Partial<FrameMessage> | null;
  if (!data || typeof data !== 'object') return false;
  if (data.source !== 'snappedcut') return false;
  if (data.frameId !== expected.frameId) return false;
  if (typeof data.type !== 'string') return false;
  return (FRAME_EVENTS as readonly string[]).includes(data.type);
}

/** The frame's URL, including the parts it needs before it can ask us anything. */
export function frameUrl(config: {
  origin?: string | undefined;
  publishableKey?: string | undefined;
  token?: string | undefined;
  locale?: string | undefined;
  features?: unknown;
  frameId: string;
}): string {
  const origin = (config.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  const url = new URL('/embed', origin);
  url.searchParams.set('v', String(PROTOCOL_VERSION));
  url.searchParams.set('frame', config.frameId);
  if (config.publishableKey) url.searchParams.set('key', config.publishableKey);
  if (config.locale) url.searchParams.set('locale', config.locale);
  // Not a secret, and only ever narrows what the token grants, so the query is fine.
  if (config.features) url.searchParams.set('features', JSON.stringify(config.features));
  // The token goes in the hash, not the query: a hash is not sent to the
  // server, does not reach access logs and does not survive a referrer header.
  return config.token ? `${url.toString()}#t=${encodeURIComponent(config.token)}` : url.toString();
}

/** Random enough to separate two embeds on a page; not a secret. */
export function newFrameId(): string {
  const bytes = new Uint8Array(9);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * How long to wait before asking for a token again.
 *
 * 1s, 2s, 4s … capped at 30s. The frame backs its own reports off on the same
 * ladder, so without a cap a slow `getToken` and a retrying frame would race
 * each other into a request storm.
 */
export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
}
