export type Params = Readonly<Record<string, string | number>>

export interface Explained {
  readonly message: string
  readonly fix: string
}

export type VerdictTexts = Readonly<Record<string, (params: Params) => Explained>>

export interface Explainable {
  readonly contract: string
  readonly message: string
  readonly fix: string
  readonly code?: string
  readonly params?: Params
}

export function explain(violation: Explainable, texts: VerdictTexts): Explained {
  const params = violation.params
  if (params === undefined) return { message: violation.message, fix: violation.fix }
  const code = violation.code
  const text =
    code === undefined
      ? texts[violation.contract]
      : (texts[code] ?? texts[`${code.slice(0, code.indexOf('.'))}.*`])
  return text === undefined ? { message: violation.message, fix: violation.fix } : text(params)
}

export function param(params: Params, name: string): string {
  const value = params[name]
  return value === undefined ? '' : String(value)
}
