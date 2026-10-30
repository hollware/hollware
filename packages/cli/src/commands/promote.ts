import { describeSite, listEntries } from '@hollware/core'
import { resolve } from 'node:path'
import { parseFlags } from '../args.ts'
import { CliError, UsageError } from '../errors.ts'
import { printable } from '../format.ts'
import { openSession, ToolFailure, type Session } from '../import/session.ts'
import type { Io } from '../io.ts'
import {
  askForReviews,
  pendingReviews,
  publishNow,
  stillPending,
  type Delivery,
  type Member,
} from '../promote/deliver.ts'
import {
  copyAssets,
  destinationOf,
  inspect,
  write,
  type Promotion,
  type Written,
} from '../promote/destination.ts'
import { readSource, type Scope } from '../promote/source.ts'
import {
  defaultStatePath,
  digest,
  readState,
  scopeOf,
  writeState,
  type PromoteState,
} from '../promote/state.ts'
import { readVersion } from '../version.ts'
import { mcpEndpoint, readToken, redact, withAssetIds, withoutToken } from './import.ts'

export const PROMOTE_USAGE = [
  'Usage: hollware promote --from <url> --from-token-file <file> --to <url> --to-token-file <file>',
  '                        [--collection <name>]... [--locale <code>] [--tag <tag>]',
  '                        [--since <time> | --all] [--state <file>] [--publish] [--dry-run] [--json]',
  '',
  'Copies what is published on one Hollware (such as staging) to another (such as production), as',
  'drafts there, and asks for one review that publishes them together. Entries are matched by',
  'collection, locale and slug. Only what changed since the last promotion is read: the state file',
  'remembers where it stopped and what it promoted. An entry the source no longer publishes is',
  'unpublished by the same review. An entry whose published version changed in the destination',
  'since the last promotion is still promoted, and the review says so on it, with the difference.',
  'The images the entries show are copied when the destination does not have them.',
  '',
  'Options:',
  '  --from <url>             The Hollware to read, such as https://staging.example.com',
  '  --from-token-file <file> A file with a personal token of the source: content:read',
  '  --to <url>               The Hollware to write to, such as https://cms.example.com',
  '  --to-token-file <file>   A file with a personal token of the destination: content:read and',
  '                           content:write, and content:publish for --publish',
  '  --collection <name>      Promote only this collection; repeat it for several',
  '  --locale <code>          Promote only this locale',
  '  --tag <tag>              Promote only the entries with this tag',
  '  --since <time>           Read what changed at or after this ISO 8601 time, not since the state',
  '  --all                    Read every published entry, whatever the state says',
  '  --state <file>           Where to keep the state (default .hollware/promote-<from>-<to>.json)',
  '  --publish                Publish instead of asking for a review; an entry changed in the',
  '                           destination still goes to a review',
  '  --dry-run                Print what it would do, and write nothing, the state included',
  '  --json                   One JSON object on stdout and nothing else',
  '  --help                   Show this help',
].join('\n')

interface Options {
  io: Io
  from: URL
  to: URL
  fromToken: string
  toToken: string
  collections: readonly string[] | undefined
  locale: string | undefined
  tag: string | undefined
  since: string | undefined
  all: boolean
  statePath: string
  stateShown: string
  state: PromoteState
  publish: boolean
  dryRun: boolean
  json: boolean
}

export async function promote(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseFlags({
    args: [...argv],
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      'from-token-file': { type: 'string' },
      to: { type: 'string' },
      'to-token-file': { type: 'string' },
      collection: { type: 'string', multiple: true },
      locale: { type: 'string' },
      tag: { type: 'string' },
      since: { type: 'string' },
      all: { type: 'boolean' },
      state: { type: 'string' },
      publish: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(PROMOTE_USAGE)
    return 0
  }
  if (positionals.length > 0) {
    throw new UsageError(
      `promote takes no ${printable(positionals[0] ?? '')}: name the instances with --from and --to.`,
    )
  }
  const fromAddress = required(values.from, '--from', 'the Hollware to read')
  const toAddress = required(values.to, '--to', 'the Hollware to write to')
  const fromTokenFile = required(
    values['from-token-file'],
    '--from-token-file',
    'a file with a token of the source',
  )
  const toTokenFile = required(
    values['to-token-file'],
    '--to-token-file',
    'a file with a token of the destination',
  )
  if (values.since !== undefined && values.all === true) {
    throw new UsageError('--since and --all go apart: --all reads everything, --since from a time.')
  }
  if (
    values.since !== undefined &&
    !listEntries.input.shape.changedSince.safeParse(values.since).success
  ) {
    throw new UsageError(
      `--since takes an ISO 8601 date and time, such as 2026-10-12T00:00:00Z, not "${printable(values.since)}".`,
    )
  }
  const from = endpoint(fromAddress, '--from')
  const to = endpoint(toAddress, '--to')
  if (from.href === to.href) {
    throw new UsageError(
      '--from and --to are the same Hollware: promote copies from one to another.',
    )
  }
  const stateShown = values.state ?? defaultStatePath(from, to)
  const statePath = resolve(io.cwd, stateShown)
  const state = readState(statePath, stateShown, from, to)
  const fromToken = await readToken(io, fromTokenFile)
  const toToken = await readToken(io, toTokenFile)
  try {
    return await promoteEntries({
      io,
      from,
      to,
      fromToken,
      toToken,
      collections: values.collection,
      locale: values.locale,
      tag: values.tag,
      since: values.since,
      all: values.all === true,
      statePath,
      stateShown,
      state,
      publish: values.publish === true,
      dryRun: values['dry-run'] === true,
      json: values.json === true,
    })
  } catch (error) {
    throw withoutToken(withoutToken(error, fromToken), toToken)
  }
}

function required(value: string | undefined, flag: string, what: string): string {
  if (value === undefined) throw new UsageError(`${flag} is required: ${what}.`)
  return value
}

function endpoint(address: string, flag: string): URL {
  try {
    return mcpEndpoint(address)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    throw new UsageError(error.message.split('--url').join(flag))
  }
}

async function promoteEntries(options: Options): Promise<number> {
  const { io, fromToken, toToken } = options
  const out = (message: string): void => io.out(redact(redact(message, fromToken), toToken))
  const say = options.json ? () => undefined : out
  const source = await openSession(options.from, fromToken, readVersion())
  let destination: Session | undefined
  try {
    destination = await openSession(options.to, toToken, readVersion())
    return await promoteWith(options, source, destination, say, out)
  } finally {
    await destination?.close()
    await source.close()
  }
}

async function promoteWith(
  options: Options,
  source: Session,
  to: Session,
  say: (message: string) => void,
  out: (message: string) => void,
): Promise<number> {
  const { state, dryRun } = options
  const [{ site: from }, { site: into }] = [
    await source.call(describeSite, {}),
    await to.call(describeSite, {}),
  ]
  const collections = chosen(
    from.collections.map((collection) => collection.name),
    options.collections,
  )
  const absent = collections.filter(
    (name) => !into.collections.some((collection) => collection.name === name),
  )
  if (absent.length > 0) {
    throw new CliError(
      `the destination has no collection ${absent.map((name) => printable(name)).join(', ')}: create ${absent.length === 1 ? 'it' : 'them'} there first (set_collection, or the config of the destination), then promote again. Nothing was written.`,
    )
  }
  if (options.locale !== undefined && !from.locales.includes(options.locale)) {
    throw new CliError(
      `the source has no locale ${printable(options.locale)}: it has ${from.locales.map(printable).join(', ')}.`,
    )
  }
  const scopes: Scope[] = collections.map((collection) => ({
    collection,
    locale: options.locale,
    tag: options.tag,
    since: options.all
      ? undefined
      : (options.since ?? state.cursors[scopeOf(collection, options.locale, options.tag)]),
  }))
  const changes = await readSource(source, scopes, state)
  const foreign = [...new Set(changes.changed.map((entry) => entry.locale))].filter(
    (locale) => !into.locales.includes(locale),
  )
  if (foreign.length > 0) {
    throw new CliError(
      `the destination has no locale ${foreign.map(printable).join(', ')}, which entries to promote are in: add ${foreign.length === 1 ? 'it' : 'them'} there first. Nothing was written.`,
    )
  }

  const assets = await copyAssets(
    { session: source, endpoint: options.from, token: options.fromToken },
    to,
    changes.changed,
    dryRun,
  )
  const promoted = withAssetIds(changes.changed, assets.moved)
  const previous = dryRun ? [] : await pendingReviews(to, state.reviews)
  const promotions: Promotion[] = []
  for (const entry of promoted) promotions.push(await inspect(to, entry, state.entries[entry.path]))
  const leaving: Member[] = []
  for (const path of changes.gone) {
    const there = await destinationOf(to, path)
    if (there !== undefined) leaving.push({ path, ...there })
  }

  for (const promotion of promotions) {
    say(
      `${promotion.action.padEnd(10)} ${printable(promotion.source.path)}${promotion.conflict ? '  (changed in the destination since the last promotion)' : ''}`,
    )
  }
  for (const member of leaving) say(`${'unpublish'.padEnd(10)} ${printable(member.path)}`)
  if (assets.copied + assets.present > 0) {
    say(
      `Images: ${assets.copied} ${dryRun ? 'to copy' : 'copied'}, ${assets.present} already there.`,
    )
  }

  const report = {
    from: options.from.origin,
    to: options.to.origin,
    dryRun,
    entries: promotions.map((promotion) => ({
      path: promotion.source.path,
      action: promotion.action,
      conflict: promotion.conflict,
    })),
    unpublish: leaving.map((member) => member.path),
    assets: { copied: assets.copied, present: assets.present },
  }

  if (dryRun) {
    if (options.json)
      out(
        JSON.stringify({
          ...report,
          reviews: [],
          published: 0,
          unpublished: 0,
          waiting: [],
          state: null,
        }),
      )
    else say(`Dry run: ${summary(promotions, leaving)}. Nothing was written, the state neither.`)
    return 0
  }

  const written: Written[] = []
  const failures: string[] = []
  for (const promotion of promotions) {
    try {
      written.push(await write(to, promotion))
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error
      failures.push(error.message)
    }
  }
  if (failures.length > 0) {
    throw new CliError(
      [
        `${failures.length} of ${promotions.length} entries could not be written to the destination, so no review was asked for and the state was not saved:`,
        ...failures.map((failure) => `  ${failure}`),
        'Fix them and promote again: what was written stays, unchanged.',
      ].join('\n'),
    )
  }

  const { held, cancelled } = await stillPending(to, previous)
  const holding = new Set(
    held.flatMap((review) => [...review.publish, ...review.unpublish].map((member) => member.path)),
  )
  const toPublish: Member[] = written
    .filter((one) => one.pending && !holding.has(one.promotion.source.path))
    .map((one) => ({ path: one.promotion.source.path, id: one.id, version: one.version }))
  const toUnpublish = leaving.filter((member) => !holding.has(member.path))
  for (const review of cancelled) {
    for (const member of review.publish) {
      if (!toPublish.some((one) => one.id === member.id)) toPublish.push(member)
    }
    for (const member of review.unpublish) {
      if (!toUnpublish.some((one) => one.id === member.id)) toUnpublish.push(member)
    }
  }
  const conflicts = new Map(
    written.filter((one) => one.promotion.conflict).map((one) => [one.promotion.source.path, one]),
  )
  const acknowledged = [
    ...new Map(
      changes.changed
        .flatMap((entry) => entry.acknowledged)
        .map((warning) => [`${warning.contract} ${warning.path}`, warning]),
    ).values(),
  ]
  const delivery: Delivery = {
    reviews: [],
    published: 0,
    unpublished: 0,
    waiting: [],
    asked: new Set(),
  }
  if (options.publish) {
    await publishNow(
      to,
      toPublish.filter((member) => !conflicts.has(member.path)),
      toUnpublish,
      acknowledged,
      delivery,
    )
    await askForReviews(
      to,
      toPublish.filter((member) => conflicts.has(member.path)),
      [],
      conflicts,
      acknowledged,
      delivery,
    )
  } else {
    await askForReviews(to, toPublish, toUnpublish, conflicts, acknowledged, delivery)
  }

  for (const one of written) {
    state.entries[one.promotion.source.path] = {
      sourceEntry: one.promotion.source.entryId,
      sourceRevision: one.promotion.source.revision,
      destinationRevision: one.promotion.destinationRevision,
      promoted: digest(one.stored),
    }
  }
  for (const path of changes.gone) {
    const known = state.entries[path]
    if (delivery.waiting.includes(path) && known !== undefined) {
      state.entries[path] = { ...known, unpublish: true }
    } else {
      delete state.entries[path]
    }
  }
  for (const [scope, latest] of changes.latest) state.cursors[scope] = latest
  state.reviews = [...held.map((review) => review.id), ...delivery.reviews]
  writeState(options.statePath, state)

  if (options.json) {
    out(
      JSON.stringify({
        ...report,
        reviews: delivery.reviews,
        published: delivery.published,
        unpublished: delivery.unpublished,
        waiting: delivery.waiting,
        state: options.stateShown,
      }),
    )
    return 0
  }
  if (delivery.reviews.length > 1) {
    say(
      `More than ${100} changes: asked for ${delivery.reviews.length} reviews, ${delivery.reviews.join(', ')}.`,
    )
  } else if (delivery.reviews.length === 1) {
    say(
      `Asked for the review ${delivery.reviews[0] ?? ''}: approve it in the admin of ${options.to.origin} to publish.`,
    )
  }
  if (delivery.published + delivery.unpublished > 0) {
    say(`Published ${delivery.published}, unpublished ${delivery.unpublished}.`)
  }
  if (delivery.waiting.length > 0) {
    say(
      `${delivery.waiting.length} ${delivery.waiting.length === 1 ? 'entry waits' : 'entries wait'} to be unpublished with the next promotion that has an entry to publish, or with --publish: ${delivery.waiting.map(printable).join(', ')}.`,
    )
  }
  say(
    `Promoted from ${options.from.origin} to ${options.to.origin}: ${summary(promotions, leaving)}. State in ${printable(options.stateShown)}.`,
  )
  return 0
}

function summary(promotions: readonly Promotion[], leaving: readonly Member[]): string {
  const of = (action: Promotion['action']) =>
    promotions.filter((promotion) => promotion.action === action).length
  const conflicts = promotions.filter((promotion) => promotion.conflict).length
  return `${of('create')} to create, ${of('update')} to update, ${of('unchanged')} unchanged, ${conflicts} changed in the destination, ${leaving.length} to unpublish`
}

function chosen(available: readonly string[], asked: readonly string[] | undefined): string[] {
  if (asked === undefined) return [...available]
  const unknown = asked.filter((name) => !available.includes(name))
  if (unknown.length > 0) {
    throw new CliError(
      `the source has no collection ${unknown.map((name) => printable(name)).join(', ')}: it has ${available.map(printable).join(', ')}.`,
    )
  }
  return [...new Set(asked)]
}
