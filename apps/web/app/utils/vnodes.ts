export function textOfVNodes(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOfVNodes).join('')
  if (typeof value !== 'object' || value === null) return ''
  const children = (value as { children?: unknown }).children
  if (typeof children === 'string' || Array.isArray(children)) return textOfVNodes(children)
  if (typeof children === 'object' && children !== null) {
    const slot = (children as { default?: unknown }).default
    return typeof slot === 'function' ? textOfVNodes((slot as () => unknown)()) : ''
  }
  return ''
}
