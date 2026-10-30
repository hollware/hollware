import {
  createHollware,
  type CollectionNavigation,
  type EntryPage,
  type Hollware,
  type HollwareOptions,
  type ListEntriesOptions,
  type NavigationOptions,
  type PageEntry,
} from '@hollware/client'
import {
  inject,
  ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watchEffect,
  type App,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Plugin,
  type Ref,
} from 'vue'

const HOLLWARE: InjectionKey<Hollware> = Symbol('hollware')

/** Makes `app` read Hollware for the composables below. */
export function provideHollware(app: App, options: HollwareOptions): void {
  app.provide(HOLLWARE, createHollware(options))
}

/** `provideHollware` as a plugin: `createApp(App).use(createHollwarePlugin({ site, url, token }))`. */
export function createHollwarePlugin(options: HollwareOptions): Plugin {
  return { install: (app) => provideHollware(app, options) }
}

/**
 * What a composable gives: the answer, the error of the last read, and whether a read is under
 * way. `data` keeps the previous answer while the next one loads, and is `undefined` after an
 * error.
 */
export interface HollwareState<T> {
  readonly data: Readonly<Ref<T | undefined>>
  readonly error: Readonly<Ref<Error | undefined>>
  readonly pending: Readonly<Ref<boolean>>
}

function hollwareOf(): Hollware {
  const hollware = inject(HOLLWARE, undefined)
  if (hollware === undefined) {
    throw new Error(
      'Hollware: nothing provides it to this app: add `app.use(createHollwarePlugin({ site, url, token }))`.',
    )
  }
  return hollware
}

function useRead<T>(read: (hollware: Hollware) => Promise<T>): HollwareState<T> {
  const hollware = hollwareOf()
  const data = shallowRef<T>()
  const error = shallowRef<Error>()
  const pending = ref(true)
  watchEffect((onCleanup) => {
    let stale = false
    onCleanup(() => {
      stale = true
    })
    pending.value = true
    new Promise<T>((resolve) => resolve(read(hollware))).then(
      (value) => {
        if (stale) return
        data.value = value
        error.value = undefined
        pending.value = false
      },
      (cause: unknown) => {
        if (stale) return
        data.value = undefined
        error.value = cause instanceof Error ? cause : new Error(String(cause))
        pending.value = false
      },
    )
  })
  return {
    data: shallowReadonly(data),
    error: shallowReadonly(error),
    pending: shallowReadonly(pending),
  }
}

/**
 * A published entry with its Comark document, for `<HollwareContent>`. `data` is `undefined`
 * while it loads and when the entry is not published (`pending` is `false` then, and `error` too).
 */
export function useHollwareEntry(
  collection: MaybeRefOrGetter<string>,
  locale: MaybeRefOrGetter<string>,
  slug: MaybeRefOrGetter<string>,
): HollwareState<PageEntry> {
  return useRead(async (hollware) => {
    const answer = await hollware.getEntry(toValue(collection), toValue(locale), toValue(slug))
    return answer?.entry
  })
}

/** A page of the published entries of a collection, newest first. */
export function useHollwareEntries(
  collection: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<ListEntriesOptions> = {},
): HollwareState<EntryPage> {
  return useRead((hollware) => hollware.listEntries(toValue(collection), toValue(options)))
}

/** The published entries of a collection grouped and ordered for a sidebar, as its navigation says. */
export function useHollwareNavigation(
  collection: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<NavigationOptions> = {},
): HollwareState<CollectionNavigation> {
  return useRead((hollware) => hollware.getNavigation(toValue(collection), toValue(options)))
}
