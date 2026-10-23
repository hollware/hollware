type Json = Readonly<Record<string, unknown>>
type Schema = Json

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const objectAt = (value: Json, key: string): Json => {
  const found = value[key]
  return isObject(found) ? found : {}
}
const stringsAt = (value: Json, key: string): string[] => {
  const found = value[key]
  return Array.isArray(found)
    ? found.filter((item): item is string => typeof item === 'string')
    : []
}
const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value)
const typesOf = (schema: Schema): string[] => {
  const type = schema['type']
  return Array.isArray(type)
    ? type.map(textOf).sort((a, b) => a.localeCompare(b))
    : type === undefined
      ? []
      : [textOf(type)]
}

const variantsOf = (schema: Schema): Schema[] => {
  const union = schema['anyOf'] ?? schema['oneOf']
  return Array.isArray(union) ? union.filter(isObject) : [schema]
}

function keyOf(schema: Schema): string {
  for (const field of ['kind', 'outcome']) {
    const property = objectAt(objectAt(schema, 'properties'), field)
    const fixed =
      property['const'] ??
      (Array.isArray(property['enum']) ? property['enum'].join('|') : undefined)
    if (fixed !== undefined)
      return `${field}=${typeof fixed === 'string' ? fixed : JSON.stringify(fixed)}`
  }
  return typesOf(schema).join('|') || 'any'
}

function compareSchemas(
  path: string,
  before: Schema,
  after: Schema,
  side: 'input' | 'output',
  breaks: string[],
): void {
  const beforeVariants = variantsOf(before)
  const afterVariants = variantsOf(after)
  if (beforeVariants.length > 1 || afterVariants.length > 1) {
    const afterByKey = new Map(afterVariants.map((variant) => [keyOf(variant), variant]))
    for (const variant of beforeVariants) {
      const key = keyOf(variant)
      const match = afterByKey.get(key)
      if (match === undefined) {
        if (side === 'input') breaks.push(`${path}: the ${key} it took is refused`)
        else if (key.startsWith('kind=')) breaks.push(`${path}: ${key} is no longer sent`)
        continue
      }
      compareSchemas(path, variant, match, side, breaks)
    }
    return
  }
  const beforeTypes = typesOf(before)
  const afterTypes = typesOf(after)
  if (beforeTypes.length > 0 && afterTypes.length > 0) {
    const lost = beforeTypes.filter((type) => !afterTypes.includes(type))
    const gained = afterTypes.filter((type) => !beforeTypes.includes(type))
    if (side === 'input' && lost.length > 0)
      breaks.push(`${path}: no longer takes ${lost.join(', ')}`)
    if (side === 'output' && gained.length > 0)
      breaks.push(`${path}: may now be ${gained.join(', ')}`)
  }
  const beforeEnum = before['enum']
  const afterEnum = after['enum']
  if (side === 'input' && Array.isArray(beforeEnum) && Array.isArray(afterEnum)) {
    for (const value of beforeEnum) {
      if (!afterEnum.includes(value))
        breaks.push(`${path}: no longer takes ${JSON.stringify(value)}`)
    }
  }
  if (side === 'input' && before['const'] !== undefined && before['const'] !== after['const']) {
    breaks.push(`${path}: no longer takes ${JSON.stringify(before['const'])}`)
  }
  const beforeProperties = objectAt(before, 'properties')
  const afterProperties = objectAt(after, 'properties')
  const beforeRequired = stringsAt(before, 'required')
  const afterRequired = stringsAt(after, 'required')
  if (side === 'input') {
    for (const name of afterRequired) {
      if (!beforeRequired.includes(name)) breaks.push(`${path}.${name}: is now required`)
    }
    for (const name of Object.keys(beforeProperties)) {
      if (!(name in afterProperties) && after['additionalProperties'] === false) {
        breaks.push(`${path}.${name}: is refused`)
      }
    }
  } else {
    for (const name of Object.keys(beforeProperties)) {
      if (!(name in afterProperties)) breaks.push(`${path}.${name}: is no longer sent`)
    }
    for (const name of beforeRequired) {
      if (name in afterProperties && !afterRequired.includes(name)) {
        breaks.push(`${path}.${name}: may now be missing`)
      }
    }
  }
  for (const [name, schema] of Object.entries(beforeProperties)) {
    const next = afterProperties[name]
    if (isObject(schema) && isObject(next))
      compareSchemas(`${path}.${name}`, schema, next, side, breaks)
  }
  const beforeItems = before['items']
  const afterItems = after['items']
  if (isObject(beforeItems) && isObject(afterItems)) {
    compareSchemas(`${path}[]`, beforeItems, afterItems, side, breaks)
  }
}

interface Tool {
  readonly name: string
  readonly scopes: readonly string[]
  readonly input: Schema
  readonly output: Schema
}

function toolsOf(mcp: Json): Tool[] {
  const tools = mcp['tools']
  return Array.isArray(tools) ? (tools.filter(isObject) as unknown as Tool[]) : []
}

function compareMcp(before: Json, after: Json, breaks: string[]): void {
  const next = new Map(toolsOf(after).map((tool) => [tool.name, tool]))
  for (const tool of toolsOf(before)) {
    const match = next.get(tool.name)
    if (match === undefined) {
      breaks.push(`mcp ${tool.name}: the tool is gone`)
      continue
    }
    for (const scope of match.scopes) {
      if (!tool.scopes.includes(scope)) breaks.push(`mcp ${tool.name}: now asks for ${scope}`)
    }
    compareSchemas(`mcp ${tool.name} input`, tool.input, match.input, 'input', breaks)
    compareSchemas(`mcp ${tool.name} output`, tool.output, match.output, 'output', breaks)
  }
}

function compareHttp(before: Json, after: Json, breaks: string[]): void {
  const afterPaths = objectAt(after, 'paths')
  for (const [path, operations] of Object.entries(objectAt(before, 'paths'))) {
    if (!isObject(operations)) continue
    const next = objectAt(afterPaths, path)
    for (const [method, operation] of Object.entries(operations)) {
      const match = next[method]
      if (!isObject(operation)) continue
      if (!isObject(match)) {
        breaks.push(`http ${method.toUpperCase()} ${path}: is gone`)
        continue
      }
      const where = `http ${method.toUpperCase()} ${path}`
      const parameters = (value: Json) =>
        new Map(
          (Array.isArray(value['parameters']) ? value['parameters'] : [])
            .filter(isObject)
            .map((parameter) => [
              `${String(parameter['in'])} ${String(parameter['name'])}`,
              parameter,
            ]),
        )
      const beforeParameters = parameters(operation)
      for (const [key, parameter] of parameters(match)) {
        if (parameter['required'] === true && beforeParameters.get(key)?.['required'] !== true) {
          breaks.push(`${where}: the ${key} parameter is now required`)
        }
      }
      const schemaOf = (response: unknown) =>
        objectAt(
          objectAt(objectAt(isObject(response) ? response : {}, 'content'), 'application/json'),
          'schema',
        )
      for (const [status, response] of Object.entries(objectAt(operation, 'responses'))) {
        const beforeSchema = schemaOf(response)
        const nextSchema = schemaOf(objectAt(objectAt(match, 'responses'), status))
        if (Object.keys(beforeSchema).length > 0) {
          compareSchemas(`${where} ${status}`, beforeSchema, nextSchema, 'output', breaks)
        }
      }
    }
  }
}

export function onlyAddsOptional(was: string, now: string): boolean {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
  const before = flat(was)
  const members = /readonly (\w+)\?: ((?:[^{}]|\{[^{}]*\})+?)(?= readonly |\s*\})/g
  const trimmed = flat(now).replace(members, (member, name: string) =>
    before.includes(`readonly ${name}?:`) ? member : '',
  )
  return flat(trimmed) === before
}

function compareNamed(
  what: string,
  before: Json,
  after: Json,
  breaks: string[],
  changed: (name: string, was: unknown, now: unknown) => string | null,
): void {
  for (const [name, value] of Object.entries(before)) {
    if (!(name in after)) {
      breaks.push(`${what} ${name}: is gone`)
      continue
    }
    const sentence = changed(name, value, after[name])
    if (sentence !== null) breaks.push(sentence)
  }
}

export function breakingChanges(
  before: Readonly<Record<string, Json>>,
  after: Readonly<Record<string, Json>>,
): string[] {
  const breaks: string[] = []
  const part = (file: string, from: Readonly<Record<string, Json>>) => from[file] ?? {}
  compareMcp(part('mcp.json', before), part('mcp.json', after), breaks)
  compareHttp(part('http.json', before), part('http.json', after), breaks)
  compareSchemas('event', part('events.json', before), part('events.json', after), 'output', breaks)
  compareNamed(
    'rpc',
    part('rpc.json', before),
    part('rpc.json', after),
    breaks,
    (name, was, now) =>
      was === now || onlyAddsOptional(String(was), String(now))
        ? null
        : `rpc ${name}: its signature changed, from ${String(was)} to ${String(now)}`,
  )
  const cliBefore = part('cli.json', before)
  const cliAfter = part('cli.json', after)
  for (const command of stringsAt(cliBefore, 'commands')) {
    if (!stringsAt(cliAfter, 'commands').includes(command))
      breaks.push(`cli ${command}: the command is gone`)
  }
  const flagsAfter = objectAt(cliAfter, 'flags')
  for (const [file, parsers] of Object.entries(objectAt(cliBefore, 'flags'))) {
    const now = new Set(
      (Array.isArray(flagsAfter[file]) ? (flagsAfter[file] as unknown[]) : [])
        .filter(isObject)
        .flatMap((options) => Object.keys(options)),
    )
    for (const options of Array.isArray(parsers) ? parsers.filter(isObject) : []) {
      for (const flag of Object.keys(options)) {
        if (!now.has(flag)) breaks.push(`cli ${file} --${flag}: the flag is gone`)
      }
    }
  }
  const exportsAfter = part('exports.json', after)
  for (const [pkg, entries] of Object.entries(part('exports.json', before))) {
    for (const [entry, names] of Object.entries(isObject(entries) ? entries : {})) {
      const now = objectAt(objectAt(exportsAfter, pkg), entry)
      if (!(entry in objectAt(exportsAfter, pkg))) {
        breaks.push(`exports ${pkg} ${entry}: the entry is gone`)
        continue
      }
      for (const [name, kind] of Object.entries(isObject(names) ? names : {})) {
        if (!(name in now)) breaks.push(`exports ${pkg} ${entry} ${name}: is gone`)
        else if (kind === 'value' && now[name] === 'type') {
          breaks.push(`exports ${pkg} ${entry} ${name}: is a type now, no longer a value`)
        }
      }
    }
  }
  compareNamed(
    'migration',
    part('migrations.json', before),
    part('migrations.json', after),
    breaks,
    (name, was, now) =>
      was === now ? null : `migration ${name}: it changed after it was published`,
  )
  return breaks
}
