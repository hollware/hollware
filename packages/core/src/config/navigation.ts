import type { Problems } from './config-error.ts'
import { describeShape, resolveSchema } from './json-schema.ts'
import type { ResolvedNavigation } from './types.ts'
import { isRecord, itemPath, type JsonObject, keyPath, quote, wrongType } from './values.ts'

interface FrontmatterSchema {
  readonly document: JsonObject
  readonly object: JsonObject
}

const SHAPE_FIX =
  'Set it to { groupBy: "<field>", groups: [...], orderBy: "<field>" }, each part optional, or remove it.'

function propertyOf(
  path: string,
  field: string,
  schema: FrontmatterSchema,
  problems: Problems,
): JsonObject | null {
  const properties = isRecord(schema.object['properties']) ? schema.object['properties'] : {}
  if (!Object.hasOwn(properties, field)) {
    problems.add(
      path,
      `${quote(field)} is not a property of the schema`,
      `Name a field that the schema declares, or add ${quote(field)} to the schema.`,
    )
    return null
  }
  const node = resolveSchema(schema.document, properties[field])
  return node ?? {}
}

function readFieldName(path: string, raw: unknown, problems: Problems): string | null {
  if (typeof raw === 'string' && raw !== '') return raw
  problems.add(
    path,
    wrongType(raw, 'the name of a frontmatter field'),
    'Set it to the name of a field of the frontmatter schema, or remove it.',
  )
  return null
}

function enumOf(node: JsonObject | null): string[] | null {
  const values = node?.['enum']
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string') : null
}

function readGroups(
  path: string,
  raw: unknown,
  values: readonly string[] | null,
  problems: Problems,
): string[] | null {
  if (!Array.isArray(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an array of group names'),
      'List the groups in the order they come, such as ["start", "guides"], or remove it.',
    )
    return null
  }
  const groups: string[] = []
  const items: readonly unknown[] = raw
  items.forEach((group, index) => {
    const at = itemPath(path, index)
    if (typeof group !== 'string' || group === '') {
      problems.add(at, wrongType(group, 'a group name'), 'Write each group as a non-empty string.')
    } else if (groups.includes(group)) {
      problems.add(at, `repeats ${quote(group)}`, 'Name each group once.')
    } else if (values !== null && !values.includes(group)) {
      problems.add(
        at,
        `${quote(group)} is not a value of the enum`,
        `Use values of the enum: ${values.map(quote).join(', ')}.`,
      )
    } else {
      groups.push(group)
    }
  })
  return groups
}

export function readNavigation(
  path: string,
  raw: unknown,
  schema: FrontmatterSchema | null,
  problems: Problems,
): ResolvedNavigation | null {
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object like { groupBy, groups, orderBy }'), SHAPE_FIX)
    return null
  }
  let groupBy: string | null = null
  let values: string[] | null = null
  if (raw['groupBy'] !== undefined) {
    const at = keyPath(path, 'groupBy')
    groupBy = readFieldName(at, raw['groupBy'], problems)
    const node =
      groupBy === null || schema === null ? null : propertyOf(at, groupBy, schema, problems)
    if (groupBy !== null && node !== null && node['type'] !== 'string') {
      problems.add(
        at,
        `${quote(groupBy)} is declared as ${describeShape(schema?.document ?? {}, node)}, but it must be a string or an enum`,
        `Declare ${quote(groupBy)} as z.string() or z.enum([...]) in the schema, or name another field.`,
      )
    }
    values = enumOf(node)
  }
  let orderBy: string | null = null
  if (raw['orderBy'] !== undefined) {
    const at = keyPath(path, 'orderBy')
    orderBy = readFieldName(at, raw['orderBy'], problems)
    const node =
      orderBy === null || schema === null ? null : propertyOf(at, orderBy, schema, problems)
    if (
      orderBy !== null &&
      node !== null &&
      node['type'] !== 'integer' &&
      node['type'] !== 'number'
    ) {
      problems.add(
        at,
        `${quote(orderBy)} is declared as ${describeShape(schema?.document ?? {}, node)}, but it must be a number`,
        `Declare ${quote(orderBy)} as z.number() or z.number().int() in the schema, or name another field.`,
      )
    }
  }
  let groups: string[] | null = values
  if (raw['groups'] !== undefined) {
    const at = keyPath(path, 'groups')
    if (raw['groupBy'] === undefined) {
      problems.add(
        at,
        'lists groups, but there is no groupBy to group by',
        'Add groupBy, the field whose value names the group, or remove groups.',
      )
    }
    const given = readGroups(at, raw['groups'], values, problems)
    groups =
      given === null
        ? values
        : [...given, ...(values ?? []).filter((value) => !given.includes(value))]
  }
  return { groupBy, groups, orderBy }
}
