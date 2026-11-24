import { useEffect, useRef, useState } from 'react';
import { mount, type EditorHandle, type EmbedConfig, type EditorEvents } from './index.js';

export type SnappedCutEditorProps = EmbedConfig & {
  className?: string;
  style?: React.CSSProperties;
  onReady?: (editor: EditorHandle) => void;
  onError?: (error: EditorEvents['error']) => void;
  onChange?: (change: EditorEvents['change']) => void;
  onExport?: (result: EditorEvents['export']) => void;
  onJob?: (job: EditorEvents['job']) => void;
};

/**
 * The editor as a component.
 *
 * Callbacks are read through a ref rather than listed as effect dependencies:
 * an inline `onReady` is a new function on every render, and as a dependency it
 * would tear the iframe down and remount it on each one.
 */
export function SnappedCutEditor(props: SnappedCutEditorProps): React.ReactElement {
  const {
    className,
    style,
    onReady,
    onError,
    onChange,
    onExport,
    onJob,
    publishableKey,
    token,
    getToken,
    origin,
    locale,
    theme,
    features,
    project,
  } = props;

  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onReady, onError, onChange, onExport, onJob, getToken });
  const editorRef = useRef<EditorHandle | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Compared as JSON: an inline object literal is a new object every render.
  const featuresKey = features ? JSON.stringify(features) : '';
  const themeKey = theme ? JSON.stringify(theme) : '';
  const [error, setError] = useState<Error | null>(null);

  handlers.current = { onReady, onError, onChange, onExport, onJob, getToken };

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    let editor: EditorHandle | undefined;
    let cancelled = false;

    void mount(node, {
      ...(publishableKey ? { publishableKey } : {}),
      ...(token ? { token } : {}),
      ...(origin ? { origin } : {}),
      ...(locale ? { locale } : {}),
      ...(themeRef.current ? { theme: themeRef.current } : {}),
      ...(featuresKey ? { features: JSON.parse(featuresKey) } : {}),
      ...(project ? { project } : {}),
      getToken: () => handlers.current.getToken?.() ?? '',
    })
      .then((handle) => {
        // Strict mode runs effects twice; without this the first mount's frame
        // is orphaned in the DOM with a live message listener.
        if (cancelled) { handle.destroy(); return; }
        editor = handle;
        editorRef.current = handle;
        handle.on('error', (e) => handlers.current.onError?.(e));
        handle.on('change', (e) => handlers.current.onChange?.(e));
        handle.on('export', (e) => handlers.current.onExport?.(e));
        handle.on('job', (e) => handlers.current.onJob?.(e));
        handlers.current.onReady?.(handle);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e);
        handlers.current.onError?.({ code: 'mount_failed', message: e.message });
      });

    return () => {
      cancelled = true;
      editorRef.current = null;
      editor?.destroy();
    };
  }, [publishableKey, token, origin, locale, featuresKey, project]);

  // A theme change is a message, not a remount: the seller keeps their edit.
  useEffect(() => {
    if (themeKey) editorRef.current?.setTheme(JSON.parse(themeKey));
  }, [themeKey]);

  if (error && !onError) throw error;
  return <div ref={host} className={className} style={{ height: '100%', ...style }} />;
}

export default SnappedCutEditor;
