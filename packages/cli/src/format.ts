/**
 * Text for the terminal: a value that came from the database or from a server is made safe to
 * print, and rows are laid out in aligned columns.
 */

// Control characters, which a terminal would act on, and invisible formatting characters.
const UNSAFE_FOR_TERMINAL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** `text` with every control or invisible formatting character replaced by `?`. */
export function printable(text: string): string {
  return text.replace(UNSAFE_FOR_TERMINAL, '?')
}

/** Rows of cells in columns as wide as their widest cell, separated by two spaces. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const all = [header, ...rows]
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => Array.from(row[column] ?? '').length)),
  )
  return all
    .map((row) =>
      row
        .map((cell, column) => {
          const padding = ' '.repeat((widths[column] ?? 0) - Array.from(cell).length)
          return column === row.length - 1 ? cell : `${cell}${padding}`
        })
        .join('  '),
    )
    .join('\n')
}
