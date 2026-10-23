import type { ReactNode } from 'react'

export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  return (
    <aside className={`callout callout-${type ?? 'note'}`} data-callout={type ?? 'note'}>
      {children}
    </aside>
  )
}
