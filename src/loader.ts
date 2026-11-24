/**
 * The script-tag path: no build step, no import, one line in the HTML.
 *
 *   <div id="editor" style="height: 640px"></div>
 *   <script src="https://snappedcut.com/embed/v1.js"
 *           data-key="pk_live_..." data-target="#editor"></script>
 *
 * Results arrive as bubbling CustomEvents on the target element, because a page
 * using this path has no handle to pass callbacks to.
 */
import { mount, type EditorHandle, type EmbedConfig } from './index.js';

const MOUNTED = 'data-snappedcut-mounted';

type Scriptish = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
};

/** The config a `<script>` tag's data attributes describe. */
export function configFromScript(script: Scriptish): { target: string | null; config: EmbedConfig } {
  const attr = (name: string) => script.getAttribute(`data-${name}`) ?? undefined;

  let extra: Record<string, unknown> = {};
  const raw = attr('config');
  if (raw) {
    try {
      extra = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A malformed data-config must not take the whole mount down with it:
      // the key and target are usually fine and the editor can still load.
      extra = {};
    }
  }

  const key = attr('key');
  const token = attr('token');
  const locale = attr('locale');
  const origin = attr('origin');

  return {
    target: script.getAttribute('data-target'),
    config: {
      ...extra,
      ...(key ? { publishableKey: key } : {}),
      ...(token ? { token } : {}),
      ...(locale ? { locale } : {}),
      ...(origin ? { origin } : {}),
    },
  };
}

const fire = (el: Element, name: string, detail: unknown): void => {
  el.dispatchEvent(new CustomEvent(`snappedcut:${name}`, { detail, bubbles: true }));
};

/** Mounts every not-yet-mounted `<script data-target>` on the page. */
export async function autoMount(): Promise<void> {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    `script[data-target]:not([${MOUNTED}])`,
  );

  for (const script of scripts) {
    /* Stamped before the await, not after: two loads of this file — a duplicate
       tag, a bundler that also imports it — would otherwise both pass the
       check and mount two editors into one div. */
    script.setAttribute(MOUNTED, '');

    const { target, config } = configFromScript(script);
    if (!target) continue;

    const host = document.querySelector(target);
    if (!host) {
      // Report it on the script tag: the target is the thing that is missing.
      fire(script, 'error', { code: 'invalid_input', message: `No element matches ${target}.` });
      continue;
    }

    try {
      const editor: EditorHandle = await mount(host as HTMLElement, config);
      for (const name of ['error', 'change', 'export', 'job'] as const) {
        editor.on(name, (detail) => fire(host, name, detail));
      }
      fire(host, 'ready', { editor });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      fire(host, 'error', { code: e.code ?? 'mount_failed', message: e.message ?? String(error) });
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void autoMount());
  } else {
    void autoMount();
  }
}
