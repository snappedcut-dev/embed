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

/**
 * Theme tokens, the same names snapnedit takes, so one object themes both.
 * Colours are any CSS colour; `radius` is px (number) or a px/rem string;
 * `font` is a font-family list the host page has already loaded. Sent again
 * with `setTheme` to switch live; each call replaces the last, so send the
 * whole set. `mode` is accepted and ignored — the tokens are the theme.
 */
export type EmbedTheme = {
  mode?: 'dark' | 'light';
  bg?: string;
  bg2?: string;
  surface?: string;
  surface2?: string;
  line?: string;
  line2?: string;
  text?: string;
  dim?: string;
  accent?: string;
  accentText?: string;
  radius?: number | string;
  font?: string;
};

export type EmbedPanel = 'text' | 'audio' | 'captions' | 'effects' | 'mask' | 'scenes' | 'keyframes' | 'comments';

/**
 * What the editor shows. Mint the token with `features` to set the ceiling —
 * it is signed, so the page cannot exceed it — and pass `features` here to
 * narrow it further. Defaults: stock, assistant, projects and share off;
 * branding on; every panel; `formats: ['mp4']`.
 */
export type EmbedFeatures = {
  stock?: boolean;
  assistant?: boolean;
  projects?: boolean;
  share?: boolean;
  branding?: boolean;
  panels?: EmbedPanel[];
  formats?: ExportFormat[];
};

export type EmbedConfig = {
  /** `pk_live_…` or `pk_test_…` from your dashboard. Public by design; locked to an origin allowlist. */
  publishableKey?: string;
  /** A token you minted server-side. Required to export: it says who pays. */
  token?: string;
  /** Called when the frame says its token is about to expire. Return a fresh one. */
  getToken?: () => Promise<string> | string;
  /** Override for a self-hosted install. */
  origin?: string;
  /** `en` or `es`. */
  locale?: string;
  theme?: EmbedTheme;
  features?: EmbedFeatures;
  /** A project to open on load: a bundle from `getProject()`, a media Blob, or an https: URL to either. */
  project?: Blob | string;
};

export type ExportOptions = {
  /** Output width in px; the height keeps the aspect ratio. Both are rounded to even, 16–7680. */
  targetWidth?: number;
  /** Multiplies the project size, when `targetWidth` is not given. */
  scale?: number;
  /** 0–1, five steps; 0.5 is the default. */
  quality?: number;
  /** A presigned https PUT on your storage. The render goes there, and the result carries no file. */
  uploadUrl?: string;
};

/** The render types a session can be billed for. */
export type JobOperation = 'cloud-render' | 'cloud-render-4k';

type ExportFacts = {
  format: ExportFormat;
  width: number;
  height: number;
  bytes: number;
  jobId: string;
  credits: number;
};
export type ExportResult =
  | (ExportFacts & { uploaded?: false; blob: Blob })
  | (ExportFacts & { uploaded: true; contentType: string });

/** What a delivery to `uploadUrl` answers with: the facts, not the file. */
export type Uploaded = { uploaded: true; contentType: string; bytes: number };

export type JobEvent = {
  jobId: string;
  operation: JobOperation;
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
  /** Media to add, or a bundle from `getProject()` to reopen. */
  load(source: Blob | string): Promise<void>;
  export(format: ExportFormat, options?: ExportOptions): Promise<ExportResult>;
  /** The whole project — timeline and media — as a bundle `load` and `project` take back. */
  getProject(): Promise<Blob>;
  /** The same bundle, PUT to your presigned https URL instead of returned. */
  getProject(options: { uploadUrl: string }): Promise<Uploaded>;
  /** Switches the theme live, without a remount. */
  setTheme(theme: EmbedTheme): void;
  on<K extends keyof EditorEvents>(event: K, fn: (payload: EditorEvents[K]) => void): () => void;
  /** Removes the frame; focus goes back to where it was before the editor took it. */
  destroy(): void;
  readonly frame: HTMLIFrameElement;
};

const TIMEOUT_MS = 60_000;

/**
 * Loads the Snapped Cut editor into `target` and resolves with a handle to it.
 *
 * Editing and preview run in the visitor's browser. `export` renders on
 * Snapped Cut's servers, billed to the token's session, and reports itself
 * through the `job` event with the credits it cost.
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
  // The last thing in the page focused before the editor took focus, so
  // destroy() can put it back rather than drop it on <body>.
  let returnFocus: HTMLElement | null = null;
  const onFocusIn = (event: FocusEvent) => {
    if (event.target !== frame && event.target instanceof HTMLElement) returnFocus = event.target;
  };
  document.addEventListener('focusin', onFocusIn);
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
     It also restores storage, which an opaque origin denies. */
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
      if (data.error) {
        const { code, message, ...details } = data.error;
        slot.reject(new EmbedError(code, message, details));
      }
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
    document.removeEventListener('focusin', onFocusIn);
    frame.remove();
    throw error;
  }

  return {
    frame,
    load: (source) => request<void>('load', { source }),
    export: (format, options) => request<ExportResult>('export', { format, ...options }),
    getProject: ((options?: { uploadUrl: string }) => request('project', options)) as EditorHandle['getProject'],
    setTheme: (theme) => post('theme', theme),
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
      document.removeEventListener('focusin', onFocusIn);
      for (const { reject } of pending.values()) {
        reject(new EmbedError('unsupported', 'This embed was destroyed.'));
      }
      pending.clear();
      listeners.clear();
      const hadFocus = document.activeElement === frame;
      frame.remove();
      if (hadFocus && returnFocus?.isConnected) returnFocus.focus();
    },
  };
}

export default mount;
