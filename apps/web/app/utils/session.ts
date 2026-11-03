export type SessionKind = 'call' | 'out' | 'err' | 'fix' | 'person' | 'ok'

export interface SessionLine {
  readonly kind: SessionKind
  readonly text: string
}

const KINDS: Readonly<Record<string, SessionKind>> = {
  '>': 'call',
  '<': 'out',
  '!': 'err',
  '?': 'fix',
  '@': 'person',
  '✓': 'ok',
}

export function parseSession(text: string): SessionLine[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const mark = line.trimStart().charAt(0)
      const kind = KINDS[mark]
      return kind === undefined
        ? { kind: 'out', text: line.trim() }
        : { kind, text: line.trimStart().slice(mark.length).trim() }
    })
}
