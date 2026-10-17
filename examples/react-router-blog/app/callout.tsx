import type { ReactNode } from 'react'

/** The `::callout{type="tip"}` of an entry, as this site draws it. */
export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  return (
    <aside className={`callout callout-${type ?? 'note'}`} data-callout={type ?? 'note'}>
      {children}
    </aside>
  )
}
