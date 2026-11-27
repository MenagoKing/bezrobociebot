import type { ReactNode } from 'react';
import { api } from '../api.ts';

/**
 * Link do zewnętrznej strony (pump.fun, GMGN, eksplorator…). Kliknięcie otwiera go w domyślnej
 * przeglądarce systemu przez serwer aplikacji, więc karta z panelem zostaje nietknięta.
 * Gdy to się nie uda, otwiera nową kartę.
 */
export function ExtLink({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title ?? 'Otwiera się w przeglądarce'}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        api.post('/api/open-external', { url: href }).catch(() => window.open(href, '_blank', 'noopener,noreferrer'));
      }}
    >
      {children}
    </a>
  );
}
