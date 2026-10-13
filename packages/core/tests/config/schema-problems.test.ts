import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { BLOG, blogConfig, brokenSchema, failingSchema, problemsOf, schemaOf } from './support.ts'

// Fails when: resolveConfig stops reporting, with its path, its message and its fix, that the
// schema of a collection or the props of a component are not a Standard Schema with JSON Schema
// (and which of its three parts is missing), cannot be converted (the message of the library is
// kept, on one line), do not describe an object, or (props) do not reject unknown keys; that
// `translations.groupBy`, `tags` or `sortBy` is no field name, names no property of the schema, or
// names a property of the wrong type (a nullable one included, and a string without the date or
// date-time format for `sortBy`); that components is no object, a component's name breaks the
// rule or it is no object, or that its description or example is no string; when it checks the
// fields against a schema that did not convert; or when the problems of a collection come out in
// another order than schema, translations, tags, sortBy, components.

const SCHEMA_FIX =
  'Use a schema from a library that implements Standard Schema and Standard JSON Schema, such as zod 4.2 or later.'
const CONVERT_FIX =
  'Remove what JSON Schema cannot express, such as z.date() (use z.iso.date() for dates), z.custom() or z.map(), so that agents can read the schema.'
const FRONTMATTER_OBJECT_FIX =
  'Declare the frontmatter as an object, such as z.object({ title: z.string() }).'
const PROPS_OBJECT_FIX =
  'Declare the props as an object, such as z.strictObject({ type: z.enum(["info", "tip"]) }).'
const STRICT_FIX =
  'Declare the props with z.strictObject({ … }) instead of z.object({ … }), or with the strict object of your validation library, so that a prop the component does not declare is an error.'
const FIELD_NAME_FIX = 'Set it to the name of a field of the frontmatter schema, or remove it.'
const COMPONENT_FIX = 'Declare it with defineComponent({ props: z.strictObject({ … }) }).'
const COMPONENT_NAME_FIX =
  'Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "callout".'
const TEXT_FIX = 'Write it as a string, or remove it.'

interface Case {
  readonly name: string
  readonly config: unknown
  readonly problems: readonly ConfigProblem[]
}

const noValidate = {
  '~standard': { version: 1, vendor: 'test', jsonSchema: { input: () => ({ type: 'object' }) } },
}
const noJsonSchema = {
  '~standard': { version: 1, vendor: 'test', validate: () => ({ value: 1 }) },
}
const noInput = {
  '~standard': { version: 1, vendor: 'test', validate: () => ({ value: 1 }), jsonSchema: {} },
}
const inputIsNotAFunction = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ value: 1 }),
    jsonSchema: { input: 'object' },
  },
}
const standardIsAString = { '~standard': 'yes' }

const strict = z.strictObject({})
const component = (overrides: Record<string, unknown>) => ({ props: strict, ...overrides })
const withComponents = (components: unknown) => blogConfig({ components })

const schemaCases: readonly Case[] = [
  {
    name: 'a schema that is missing',
    config: blogConfig({ schema: undefined }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'is missing; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema that is a plain object',
    config: blogConfig({ schema: { type: 'object' } }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'is an object; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema that is a string',
    config: blogConfig({ schema: 'z.object' }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'is "z.object"; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema that is a function without ~standard',
    config: blogConfig({ schema: () => 1 }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'is a function; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema whose ~standard is a string',
    config: blogConfig({ schema: standardIsAString }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'is an object; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema without ~standard.validate',
    config: blogConfig({ schema: noValidate }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'has no ~standard.validate function, so it is no Standard Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema without ~standard.jsonSchema',
    config: blogConfig({ schema: noJsonSchema }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message:
          'has no ~standard.jsonSchema.input function, so describe_site could not show it to agents',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema whose ~standard.jsonSchema has no input',
    config: blogConfig({ schema: noInput }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message:
          'has no ~standard.jsonSchema.input function, so describe_site could not show it to agents',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema whose ~standard.jsonSchema.input is a string',
    config: blogConfig({ schema: inputIsNotAFunction }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message:
          'has no ~standard.jsonSchema.input function, so describe_site could not show it to agents',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'a schema that does not convert, with the message of its library',
    config: blogConfig({ schema: failingSchema(new Error('Dates are out of scope')) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'cannot be converted to JSON Schema (Dates are out of scope)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'a schema that does not convert and throws a string',
    config: blogConfig({ schema: failingSchema('no way') }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'cannot be converted to JSON Schema (no way)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'a schema that does not convert, with a message of several lines, which stays one line',
    config: blogConfig({ schema: failingSchema(new Error('first line\n\n  second   line\n')) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'cannot be converted to JSON Schema (first line second line)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'a schema that does not convert because its JSON Schema is no object',
    config: blogConfig({ schema: brokenSchema(null) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message:
          'cannot be converted to JSON Schema (the library is null; it must be a JSON Schema object)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'a schema that has a date, which JSON Schema cannot express',
    config: blogConfig({ schema: z.object({ at: z.date() }) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'cannot be converted to JSON Schema (Date cannot be represented in JSON Schema)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'a schema that is a string',
    config: blogConfig({ schema: z.string() }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes string instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'a schema that is an array',
    config: blogConfig({ schema: z.array(z.string()) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes an array of string instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'a schema that is a union',
    config: blogConfig({
      schema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
    }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes a union instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'a schema that is anything',
    config: blogConfig({ schema: z.unknown() }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes any value instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'a schema that is an object or null',
    config: blogConfig({ schema: schemaOf({ type: ['object', 'null'] }) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes object or null instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'a schema that points to a definition that is not there',
    config: blogConfig({ schema: schemaOf({ $ref: '#/$defs/Missing' }) }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'describes an unresolvable reference instead of an object',
        fix: FRONTMATTER_OBJECT_FIX,
      },
    ],
  },
]

const fieldCases: readonly Case[] = [
  {
    name: 'translations that is a number',
    config: blogConfig({ translations: 5 }),
    problems: [
      {
        path: `${BLOG}.translations`,
        message: 'is 5; it must be an object like { groupBy: "translationGroup" }',
        fix: 'Set it to { groupBy: "<field>" }, the field of the frontmatter that holds the key the translations of an entry share, or remove it.',
      },
    ],
  },
  {
    name: 'translations without groupBy',
    config: blogConfig({ translations: {} }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: 'is missing; it must be the name of a frontmatter field',
        fix: FIELD_NAME_FIX,
      },
    ],
  },
  {
    name: 'a groupBy that is a number',
    config: blogConfig({ translations: { groupBy: 7 } }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: 'is 7; it must be the name of a frontmatter field',
        fix: FIELD_NAME_FIX,
      },
    ],
  },
  {
    name: 'a groupBy that is empty',
    config: blogConfig({ translations: { groupBy: '' } }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: 'is ""; it must be the name of a frontmatter field',
        fix: FIELD_NAME_FIX,
      },
    ],
  },
  {
    name: 'a groupBy that names no property',
    config: blogConfig({ translations: { groupBy: 'nope' } }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message:
          '"nope" is not a property of the schema (its properties are "title", "date", "tags", "group")',
        fix: 'Name a field that the schema declares, or add "nope" to the schema.',
      },
    ],
  },
  {
    name: 'a groupBy that names a property every object has, which the schema does not',
    config: blogConfig({ translations: { groupBy: 'constructor' } }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message:
          '"constructor" is not a property of the schema (its properties are "title", "date", "tags", "group")',
        fix: 'Name a field that the schema declares, or add "constructor" to the schema.',
      },
    ],
  },
  {
    name: 'a groupBy that names an array',
    config: blogConfig({ translations: { groupBy: 'tags' } }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: '"tags" is declared as an array of string, but it must be a string',
        fix: 'Declare "tags" as z.string() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a groupBy that names a number',
    config: blogConfig({
      schema: z.object({ views: z.number() }),
      translations: { groupBy: 'views' },
    }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: '"views" is declared as number, but it must be a string',
        fix: 'Declare "views" as z.string() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a tags field that is a number',
    config: blogConfig({ tags: 7 }),
    problems: [
      {
        path: `${BLOG}.tags`,
        message: 'is 7; it must be the name of a frontmatter field',
        fix: FIELD_NAME_FIX,
      },
    ],
  },
  {
    name: 'a tags field that names no property',
    config: blogConfig({ tags: 'nope' }),
    problems: [
      {
        path: `${BLOG}.tags`,
        message:
          '"nope" is not a property of the schema (its properties are "title", "date", "tags", "group")',
        fix: 'Name a field that the schema declares, or add "nope" to the schema.',
      },
    ],
  },
  {
    name: 'a tags field that names a string',
    config: blogConfig({ tags: 'title' }),
    problems: [
      {
        path: `${BLOG}.tags`,
        message: '"title" is declared as string, but it must be an array of strings',
        fix: 'Declare "title" as z.array(z.string()) in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a tags field that names an array of numbers',
    config: blogConfig({ schema: z.object({ tags: z.array(z.number()) }), tags: 'tags' }),
    problems: [
      {
        path: `${BLOG}.tags`,
        message: '"tags" is declared as an array of number, but it must be an array of strings',
        fix: 'Declare "tags" as z.array(z.string()) in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a sortBy that is a number',
    config: blogConfig({ sortBy: 7 }),
    problems: [
      {
        path: `${BLOG}.sortBy`,
        message: 'is 7; it must be the name of a frontmatter field',
        fix: FIELD_NAME_FIX,
      },
    ],
  },
  {
    name: 'a sortBy that names no property',
    config: blogConfig({ sortBy: 'nope' }),
    problems: [
      {
        path: `${BLOG}.sortBy`,
        message:
          '"nope" is not a property of the schema (its properties are "title", "date", "tags", "group")',
        fix: 'Name a field that the schema declares, or add "nope" to the schema.',
      },
    ],
  },
  {
    name: 'a sortBy that names a plain string, which may be anything',
    config: blogConfig({ sortBy: 'title' }),
    problems: [
      {
        path: `${BLOG}.sortBy`,
        message:
          '"title" is declared as string, but it must be a string with the "date" or "date-time" format',
        fix: 'Declare "title" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a sortBy that names an array',
    config: blogConfig({ sortBy: 'tags' }),
    problems: [
      {
        path: `${BLOG}.sortBy`,
        message:
          '"tags" is declared as an array of string, but it must be a string with the "date" or "date-time" format',
        fix: 'Declare "tags" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a sortBy that names a string that only has a pattern',
    config: blogConfig({
      schema: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      sortBy: 'day',
    }),
    problems: [
      {
        path: `${BLOG}.sortBy`,
        message:
          '"day" is declared as string, but it must be a string with the "date" or "date-time" format',
        fix: 'Declare "day" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'fields in a schema that has no properties',
    config: blogConfig({ schema: z.object({}), tags: 'tags' }),
    problems: [
      {
        path: `${BLOG}.tags`,
        message: '"tags" is not a property of the schema, which declares none',
        fix: 'Name a field that the schema declares, or add "tags" to the schema.',
      },
    ],
  },
  {
    name: 'nullable fields, which may be null instead of what they should be',
    config: blogConfig({
      schema: z.object({
        group: z.string().nullable(),
        tags: z.array(z.string()).nullable(),
        date: z.iso.date().nullable(),
      }),
      translations: { groupBy: 'group' },
      tags: 'tags',
      sortBy: 'date',
    }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: '"group" is declared as string or null, but it must be a string',
        fix: 'Declare "group" as z.string() in the schema, or name another field.',
      },
      {
        path: `${BLOG}.tags`,
        message: '"tags" is declared as a union, but it must be an array of strings',
        fix: 'Declare "tags" as z.array(z.string()) in the schema, or name another field.',
      },
      {
        path: `${BLOG}.sortBy`,
        message:
          '"date" is declared as a union, but it must be a string with the "date" or "date-time" format',
        fix: 'Declare "date" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'a property that no schema says anything about',
    config: blogConfig({
      schema: z.object({ group: z.unknown() }),
      translations: { groupBy: 'group' },
    }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: '"group" is declared as any value, but it must be a string',
        fix: 'Declare "group" as z.string() in the schema, or name another field.',
      },
    ],
  },
  {
    name: 'fields that are not checked against a schema that did not convert',
    config: blogConfig({
      schema: failingSchema(new Error('boom')),
      translations: { groupBy: 'x' },
      tags: 'y',
      sortBy: 'z',
    }),
    problems: [
      {
        path: `${BLOG}.schema`,
        message: 'cannot be converted to JSON Schema (boom)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'fields that are wrong, in the order translations, tags, sortBy',
    config: blogConfig({
      sortBy: 'title',
      tags: 'title',
      translations: { groupBy: 'tags' },
    }),
    problems: [
      {
        path: `${BLOG}.translations.groupBy`,
        message: '"tags" is declared as an array of string, but it must be a string',
        fix: 'Declare "tags" as z.string() in the schema, or name another field.',
      },
      {
        path: `${BLOG}.tags`,
        message: '"title" is declared as string, but it must be an array of strings',
        fix: 'Declare "title" as z.array(z.string()) in the schema, or name another field.',
      },
      {
        path: `${BLOG}.sortBy`,
        message:
          '"title" is declared as string, but it must be a string with the "date" or "date-time" format',
        fix: 'Declare "title" as z.iso.date() or z.iso.datetime() in the schema, or name another field.',
      },
    ],
  },
]

const componentCases: readonly Case[] = [
  {
    name: 'components that is a number',
    config: withComponents(5),
    problems: [
      {
        path: `${BLOG}.components`,
        message: 'is 5; it must be an object that maps each component name to its definition',
        fix: COMPONENT_FIX,
      },
    ],
  },
  {
    name: 'a component name with a capital letter',
    config: withComponents({ Callout: component({}) }),
    problems: [
      {
        path: `${BLOG}.components.Callout`,
        message: '"Callout" is not a valid component name',
        fix: COMPONENT_NAME_FIX,
      },
    ],
  },
  {
    name: 'a component name with an underscore',
    config: withComponents({ call_out: component({}) }),
    problems: [
      {
        path: `${BLOG}.components.call_out`,
        message: '"call_out" is not a valid component name',
        fix: COMPONENT_NAME_FIX,
      },
    ],
  },
  {
    name: 'a component name of 64 characters',
    config: withComponents({ [`a${'b'.repeat(63)}`]: component({}) }),
    problems: [
      {
        path: `${BLOG}.components.a${'b'.repeat(63)}`,
        message: `"a${'b'.repeat(63)}" is not a valid component name`,
        fix: COMPONENT_NAME_FIX,
      },
    ],
  },
  {
    name: 'a component that is a number',
    config: withComponents({ callout: 5 }),
    problems: [
      {
        path: `${BLOG}.components.callout`,
        message: 'is 5; it must be a component',
        fix: COMPONENT_FIX,
      },
    ],
  },
  {
    name: 'a component without props',
    config: withComponents({ callout: {} }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message: 'is missing; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'props that are a plain object',
    config: withComponents({ callout: { props: { type: 'object' } } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message: 'is an object; it must be a Standard Schema with JSON Schema',
        fix: SCHEMA_FIX,
      },
    ],
  },
  {
    name: 'props that do not convert',
    config: withComponents({ callout: { props: failingSchema(new Error('boom')) } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message: 'cannot be converted to JSON Schema (boom)',
        fix: CONVERT_FIX,
      },
    ],
  },
  {
    name: 'props that are a string',
    config: withComponents({ callout: { props: z.string() } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message: 'describes string instead of an object',
        fix: PROPS_OBJECT_FIX,
      },
    ],
  },
  {
    name: 'props made with z.object, which accepts unknown keys',
    config: withComponents({ callout: { props: z.object({ type: z.string() }) } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
    ],
  },
  {
    name: 'props made with z.looseObject',
    config: withComponents({ callout: { props: z.looseObject({ type: z.string() }) } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
    ],
  },
  {
    name: 'props made with a catchall',
    config: withComponents({
      callout: { props: z.object({ type: z.string() }).catchall(z.string()) },
    }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
    ],
  },
  {
    name: 'props that are a record',
    config: withComponents({ callout: { props: z.record(z.string(), z.string()) } }),
    problems: [
      {
        path: `${BLOG}.components.callout.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
    ],
  },
  {
    name: 'a description that is a number',
    config: withComponents({ callout: component({ description: 5 }) }),
    problems: [
      {
        path: `${BLOG}.components.callout.description`,
        message: 'is 5; it must be a string',
        fix: TEXT_FIX,
      },
    ],
  },
  {
    name: 'an example that is an array',
    config: withComponents({ callout: component({ example: ['::callout'] }) }),
    problems: [
      {
        path: `${BLOG}.components.callout.example`,
        message: 'is an array; it must be a string',
        fix: TEXT_FIX,
      },
    ],
  },
  {
    name: 'a component with every problem, in the order of its fields',
    config: withComponents({
      Callout: { props: z.object({}), description: 1, example: 2 },
    }),
    problems: [
      {
        path: `${BLOG}.components.Callout`,
        message: '"Callout" is not a valid component name',
        fix: COMPONENT_NAME_FIX,
      },
      {
        path: `${BLOG}.components.Callout.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
      {
        path: `${BLOG}.components.Callout.description`,
        message: 'is 1; it must be a string',
        fix: TEXT_FIX,
      },
      {
        path: `${BLOG}.components.Callout.example`,
        message: 'is 2; it must be a string',
        fix: TEXT_FIX,
      },
    ],
  },
  {
    name: 'two components that are wrong, in the order of the config',
    config: withComponents({
      youtube: { props: z.object({}) },
      callout: 5,
      quote: component({}),
    }),
    problems: [
      {
        path: `${BLOG}.components.youtube.props`,
        message:
          'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
        fix: STRICT_FIX,
      },
      {
        path: `${BLOG}.components.callout`,
        message: 'is 5; it must be a component',
        fix: COMPONENT_FIX,
      },
    ],
  },
]

describe('a config with problems in the schema of a collection', () => {
  it.each(schemaCases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

describe('a config with problems in the fields a collection points at', () => {
  it.each(fieldCases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})

describe('a config with problems in its components', () => {
  it.each(componentCases)('reports $name', ({ config, problems }) => {
    expect(problemsOf(config)).toEqual(problems)
  })
})
