import {
  backoffMs,
  DEFAULT_ORIGIN,
  EmbedError,
  frameUrl,
  isFrameMessage,
  newFrameId,
  PROTOCOL_VERSION,
  type EmbedErrorCode,
  type ExportFormat,
  type FrameMessage,
} from './protocol.js';

export { EmbedError, PROTOCOL_VERSION, type EmbedErrorCode, type ExportFormat };

export type EmbedTheme = { mode?: 'dark' | 'light'; accent?: string };

export type EmbedConfig = {
  /** `pk_live_…` from your dashboard. Public by design; locked to an origin allowlist. */
  publishableKey?: string;
  /** A token you minted server-side. Carries an `endUserId` for attribution. */
  token?: string;
  /** Called when the frame says its token is about to expire. Return a fresh one. */
  getToken?: () => Promise<string> | string;
  /** Override for a self-hosted install. */
  origin?: string;
  locale?: string;
  theme?: EmbedTheme;
  /** A project to open on load — a bundle Blob, or an https: URL to one. */
  project?: Blob | string;
};

export type ExportOptions = { scale?: number; targetWidth?: number; quality?: number };
export type ExportResult = {
  blob: Blob;
  format: ExportFormat;
  width: number;
  height: number;
  bytes: number;
};

export type JobEvent = {
  jobId: string;
  operation: string;
  status: 'started' | 'succeeded' | 'failed';
  credits: number;
  endUserId: string | null;
  durationMs?: number;
  error?: string;
};

export type EditorEvents = {
  ready: { version: string };
  error: { code: EmbedErrorCode; message: string };
  change: { duration: number; clips: number };
  export: ExportResult;
  job: JobEvent;
};

export type EditorHandle = {
  load(source: Blob | string): Promise<void>;
  export(format: ExportFormat, options?: ExportOptions): Promise<ExportResult>;
  getProject(): Promise<unknown>;
  on<K extends keyof EditorEvents>(event: K, fn: (payload: EditorEvents[K]) => void): () => void;
  destroy(): void;
  readonly frame: HTMLIFrameElement;
};

const TIMEOUT_MS = 60_000;

/**
 * Loads the Snapped Cut editor into `target` and resolves with a handle to it.
 *
 * The frame is a **thin client**: decode, compositing and encode all happen on
 * Snapped Cut's servers, so nothing heavy ships into the host page and no
 * engine code reaches the visitor. `load` and `export` are therefore round
 * trips, not local calls — every one is work we do and meter, and each reports
 * itself through the `job` event with the credits it cost.
 */
export async function mount(
  target: string | HTMLElement,
  config: EmbedConfig = {},
): Promise<EditorHandle> {
  if (typeof document === 'undefined') {
    throw new EmbedError('unsupported', 'mount() needs a browser.');
  }

  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!(host instanceof HTMLElement)) {
    throw new EmbedError('invalid_input', `No element for ${String(target)}.`);
  }
  if (!config.publishableKey && !config.token) {
    throw new EmbedError('invalid_input', 'mount() needs a publishableKey or a token.');
  }

  const origin = (config.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  const frameId = newFrameId();

  const frame = document.createElement('iframe');
  frame.src = frameUrl({ ...config, origin, frameId });
  frame.title = 'Snapped Cut editor';
  frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
  frame.allow = 'clipboard-write; fullscreen';
  /* `allow-same-origin` is required, and it is safe here.
     Required: without it the frame has an *opaque* origin. Everything it posts
     then arrives as `event.origin === 'null'`, which can never equal
     `config.origin`, and anything posted *to* it at a named origin is dropped.
     The origin check in `isFrameMessage` silently kills both directions — the
     editor renders and then nothing ever answers, which is the worst shape a
     bug can take.
     Safe: it makes the frame same-origin with *its own* origin, not with your
     page. A sandboxed frame can only remove its own sandbox when it is
     same-origin with the parent document, and this one is cross-origin by
     construction. What keeps a hostile frame out is `event.source ===
     frame.contentWindow` — unforgeable — not the origin string.
     It also restores storage, which an opaque origin denies, and the editor
     keeps projects in IndexedDB. */
  frame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms',
  );

  const listeners = new Map<string, Set<(payload: never) => void>>();
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();
  let nextId = 1;
  let destroyed = false;
  let refreshAttempt = 0;

  const emit = (type: string, payload: unknown): void => {
    for (const fn of listeners.get(type) ?? []) (fn as (p: unknown) => void)(payload);
  };

  const post = (type: string, payload?: unknown, id?: number): void => {
    frame.contentWindow?.postMessage(
      { source: 'snappedcut-host', v: PROTOCOL_VERSION, frameId, type, id, payload },
      origin,
    );
  };

  const request = <T>(type: string, payload?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (destroyed) { reject(new EmbedError('unsupported', 'This embed was destroyed.')); return; }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new EmbedError('network_error', `${type} did not answer within 60s.`));
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve: ((value: T) => { clearTimeout(timer); resolve(value); }) as never,
        reject: (error: unknown) => { clearTimeout(timer); reject(error); },
      });
      post(type, payload, id);
    });

  const refresh = async (): Promise<void> => {
    if (!config.getToken) {
      // Nothing to refresh, so say so once rather than letting the integrator
      // discover it through calls that quietly start failing.
      emit('error', { code: 'token_expired', message: 'The token expired and no getToken was configured.' });
      return;
    }
    try {
      const token = await config.getToken();
      refreshAttempt = 0;
      post('token', { token });
    } catch (error) {
      emit('error', { code: 'token_expired', message: `getToken failed: ${String(error)}` });
      const wait = backoffMs(refreshAttempt++);
      setTimeout(() => { if (!destroyed) void refresh(); }, wait);
    }
  };

  const onMessage = (event: MessageEvent): void => {
    if (!isFrameMessage(event, { origin, window: frame.contentWindow, frameId })) return;
    const data = event.data as FrameMessage;

    if (data.type === 'reply' && typeof data.id === 'number') {
      const slot = pending.get(data.id);
      if (!slot) return;
      pending.delete(data.id);
      if (data.error) slot.reject(new EmbedError(data.error.code, data.error.message));
      else slot.resolve(data.payload as never);
      return;
    }

    if (data.type === 'token-expiring') { void refresh(); return; }

    emit(data.type, data.payload);
  };

  window.addEventListener('message', onMessage);
  host.appendChild(frame);

  try {
    const hello = await new Promise<{ version: string }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new EmbedError('mount_failed', 'The editor frame did not load within 60s.')),
        TIMEOUT_MS,
      );
      const off = (payload: { version: string }) => { clearTimeout(timer); resolve(payload); };
      (listeners.get('ready') ?? listeners.set('ready', new Set()).get('ready')!).add(off as never);

      const onError = (payload: { code: EmbedErrorCode; message: string }) => {
        if (payload.code === 'unauthorized' || payload.code === 'origin_not_allowed') {
          clearTimeout(timer);
          reject(new EmbedError(payload.code, payload.message));
        }
      };
      (listeners.get('error') ?? listeners.set('error', new Set()).get('error')!).add(onError as never);
    });

    if (config.theme) post('theme', config.theme);
    if (config.project) await request('load', { source: config.project });

    void hello;
  } catch (error) {
    window.removeEventListener('message', onMessage);
    frame.remove();
    throw error;
  }

  return {
    frame,
    load: (source) => request<void>('load', { source }),
    export: (format, options) => request<ExportResult>('export', { format, ...options }),
    getProject: () => request<unknown>('project'),
    on(event, fn) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(fn as never);
      return () => { set.delete(fn as never); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', onMessage);
      for (const { reject } of pending.values()) {
        reject(new EmbedError('unsupported', 'This embed was destroyed.'));
      }
      pending.clear();
      listeners.clear();
      frame.remove();
    },
  };
}

export default mount;
