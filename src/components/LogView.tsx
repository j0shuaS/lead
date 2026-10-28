'use client';

import { memo, useEffect, useRef } from 'react';
import { shortLink } from '../lib/format';

export type LogLine = { level: 'info' | 'warn' | 'error'; message: string; url?: string; t: string };

export const LogView = memo(function LogView({ logs, busy, empty }: { logs: LogLine[]; busy: boolean; empty: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div className="log" ref={ref} role="log" aria-live="polite">
      {logs.length === 0 && (
        <span className="empty">
          {empty} <span className="cursor" />
        </span>
      )}
      {logs.map((l, i) => (
        <span key={i} className={`ln ${l.level}`}>
          <span className="tag">{l.t}</span> {l.level === 'error' ? '✕ ' : l.level === 'warn' ? '! ' : '· '}
          {l.message}
          {l.url && l.level !== 'info' ? `  (${shortLink(l.url)})` : ''}
        </span>
      ))}
      {busy && <span className="cursor" />}
    </div>
  );
});
