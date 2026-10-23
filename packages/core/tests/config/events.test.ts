import { describe, expect, it } from 'vite-plus/test'

import { resolveConfig } from '../../src/config/index.ts'
import { configWith, problemsOf } from './support.ts'

const site = (config: unknown) => resolveConfig(config).sites.get('demo')
const paths = (config: unknown) => problemsOf(config).map((problem) => problem.path)

describe('the url and the events of a site', () => {
  it('reads the origin, the webhooks and IndexNow', () => {
    const resolved = site(
      configWith({
        url: 'https://example.com/',
        events: {
          webhooks: [
            { name: 'newsletter', url: 'https://hooks.example.com/in', secret: 'WEBHOOK_SECRET' },
          ],
          indexNow: { key: 'a1b2c3d4e5f60718' },
        },
      }),
    )

    expect([resolved?.url, resolved?.events]).toEqual([
      'https://example.com',
      {
        webhooks: [
          { name: 'newsletter', url: 'https://hooks.example.com/in', secret: 'WEBHOOK_SECRET' },
        ],
        indexNow: { key: 'a1b2c3d4e5f60718' },
      },
    ])
  })

  it('has no url and no subscribers when the config gives none', () => {
    expect([site(configWith())?.url, site(configWith())?.events]).toEqual([
      null,
      { webhooks: [], indexNow: null },
    ])
  })

  it.each([
    ['a url with a path', { url: 'https://example.com/blog' }, ['sites.demo.url']],
    ['a url that is no URL', { url: 'example.com' }, ['sites.demo.url']],
    [
      'a webhook over http, with a bad name and secret',
      { events: { webhooks: [{ name: 'News', url: 'http://x.example', secret: 'secret' }] } },
      [
        'sites.demo.events.webhooks[0].name',
        'sites.demo.events.webhooks[0].url',
        'sites.demo.events.webhooks[0].secret',
      ],
    ],
    [
      'two webhooks with one name',
      {
        events: {
          webhooks: [
            { name: 'a', url: 'https://x.example', secret: 'S' },
            { name: 'a', url: 'https://y.example', secret: 'S' },
          ],
        },
      },
      ['sites.demo.events.webhooks[1]'],
    ],
    [
      'IndexNow without a url',
      { events: { indexNow: { key: 'a1b2c3d4e5f60718' } } },
      ['sites.demo.events.indexNow'],
    ],
    [
      'an IndexNow key that names a secret instead of being the key',
      { url: 'https://example.com', events: { indexNow: { key: 'HOLLWARE_SECRET' } } },
      ['sites.demo.events.indexNow.key'],
    ],
    [
      'a webhook that names a secret of Hollware',
      {
        events: {
          webhooks: [{ name: 'a', url: 'https://x.example', secret: 'HOLLWARE_ANALYTICS_TOKEN' }],
        },
      },
      ['sites.demo.events.webhooks[0].secret'],
    ],
    [
      'a webhook that names a secret of Cloudflare',
      {
        events: {
          webhooks: [{ name: 'a', url: 'https://x.example', secret: 'CLOUDFLARE_API_TOKEN' }],
        },
      },
      ['sites.demo.events.webhooks[0].secret'],
    ],
  ])('reports %s at its path', (_name, overrides, expected) => {
    expect(paths(configWith(overrides))).toEqual(expected)
  })
})

describe('the origins of a site that may read it from a page', () => {
  it('reads each origin as URL.origin gives it, once, and none by default', () => {
    const resolved = site(
      configWith({
        cors: { origins: ['https://example.com/', 'http://localhost:3000', 'https://example.com'] },
      }),
    )

    expect(resolved?.cors).toEqual({ origins: ['https://example.com', 'http://localhost:3000'] })
    expect(site(configWith())?.cors).toEqual({ origins: [] })
  })

  it.each([
    ['origins that are no list', { cors: { origins: 'https://example.com' } }, ['sites.demo.cors']],
    [
      'an origin with a path, and one that is no URL',
      { cors: { origins: ['https://example.com/app', 'example.com'] } },
      ['sites.demo.cors.origins[0]', 'sites.demo.cors.origins[1]'],
    ],
    [
      'an IndexNow key that names a secret instead of being the key',
      { url: 'https://example.com', events: { indexNow: { key: 'HOLLWARE_SECRET' } } },
      ['sites.demo.events.indexNow.key'],
    ],
    [
      'a webhook that names a secret of Hollware',
      {
        events: {
          webhooks: [{ name: 'a', url: 'https://x.example', secret: 'HOLLWARE_ANALYTICS_TOKEN' }],
        },
      },
      ['sites.demo.events.webhooks[0].secret'],
    ],
    [
      'a webhook that names a secret of Cloudflare',
      {
        events: {
          webhooks: [{ name: 'a', url: 'https://x.example', secret: 'CLOUDFLARE_API_TOKEN' }],
        },
      },
      ['sites.demo.events.webhooks[0].secret'],
    ],
  ])('reports %s at its path', (_name, overrides, expected) => {
    expect(paths(configWith(overrides))).toEqual(expected)
  })
})
