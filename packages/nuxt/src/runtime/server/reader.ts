import { createClient, type HollwareReader } from '@hollware/client'
import { createError, type H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { entryTags, groupTags, listTags, recordTags, siteTags } from '../tags.ts'

/** What `hollware` holds in the runtime config: the module writes it, the environment may override it. */
interface HollwareConfig {
  readonly site: string
  readonly binding: string
  readonly url: string
  readonly token: string
}

function isReader(value: unknown): value is HollwareReader {
  return typeof value === 'object' && value !== null && 'getEntry' in value
}

/**
 * The site's reader of Hollware for a request: the service binding when the Worker has it, else
 * HTTP with the URL and the read token of the config. A site with neither gets a 500 that says
 * which to set.
 */
export function useHollware(event: H3Event): { site: string; reader: HollwareReader } {
  const config = useRuntimeConfig(event)['hollware'] as HollwareConfig
  const env: unknown = event.context['cloudflare']?.env
  const binding =
    typeof env === 'object' && env !== null ? Reflect.get(env, config.binding) : undefined
  if (isReader(binding)) {
    return { site: config.site, reader: tagging(event, createClient({ binding })) }
  }
  if (config.url !== '' && config.token !== '') {
    return {
      site: config.site,
      reader: tagging(event, createClient({ url: config.url, token: config.token })),
    }
  }
  throw createError({
    statusCode: 500,
    statusMessage: `Hollware: the Worker has no binding ${config.binding}, and hollware.url with a read token (NUXT_HOLLWARE_TOKEN) is not set.`,
  })
}

/**
 * The reader, recording on the request the cache tags of what each read answered (S8): a route of
 * the site's own that reads through `useHollware` is tagged with no work of its own.
 */
function tagging(event: H3Event, reader: HollwareReader): HollwareReader {
  return {
    ...reader,
    getEntry: async (...args) => {
      const answer = await reader.getEntry(...args)
      // The latest revision of one entry, for one person: nothing may keep it by its tags.
      if (args[4]?.preview === undefined) recordTags(event, entryTags(answer.entry))
      return answer
    },
    listEntries: async (...args) => {
      const answer = await reader.listEntries(...args)
      recordTags(event, listTags(args[1], args[2]?.locale, answer.entries))
      return answer
    },
    getTranslations: async (...args) => {
      const answer = await reader.getTranslations(...args)
      recordTags(event, groupTags(args[1], args[2], answer.entries ?? []))
      return answer
    },
    describeSite: async (...args) => {
      const answer = await reader.describeSite(...args)
      recordTags(event, siteTags())
      return answer
    },
  }
}
