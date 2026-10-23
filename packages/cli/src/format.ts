const UNSAFE_FOR_TERMINAL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function printable(text: string): string {
  return text.replace(UNSAFE_FOR_TERMINAL, '?')
}

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
