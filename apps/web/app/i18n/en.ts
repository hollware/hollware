/**
 * The words of hollware.com in English, the source of every language: a language is a value of
 * `Messages`, so the type check refuses one that misses a key, adds one or changes a function.
 * The documents of the docs come from Hollware in each locale; these are the site's own words.
 */
export const en = {
  language: { name: 'English', switch: 'Leer en español', switchTo: 'Español' },
  seo: {
    home: 'Hollware: the CMS your agents write to',
    description:
      'Hollware is an open-source headless CMS on Cloudflare Workers. Agents write Markdown over MCP, contracts check every write, and your sites read it over Workers RPC.',
  },
  nav: {
    docs: 'Docs',
    tools: 'Tools',
    demo: 'Demo',
    github: 'Hollware on GitHub',
  },
  footer: 'Hollware is open source, MIT. Made for agents, kept by people.',
  copy: { copy: 'Copy the command', copied: 'Copied' },
  home: {
    badge: (version: string) => `v${version} · open source · Cloudflare Workers`,
    title: 'The CMS your agents write to',
    description:
      'Hollware is a headless CMS native to Cloudflare Workers. Agents write Markdown over MCP, contracts check every write, D1 keeps the content, and your sites read it over Workers RPC.',
    readDocs: 'Read the docs',
    why: {
      headline: 'Why Hollware',
      title: 'Content that agents can write, and that you can trust',
      description:
        'Every write goes through the same checks, whoever makes it: an agent, a person in the admin, or a script.',
    },
    features: {
      contracts: {
        title: 'Contracts on every write',
        description:
          'The schema of your frontmatter, your components and the rules you pick from a catalog check each draft. A draft that breaks one is saved anyway, with the fix an agent can apply.',
      },
      mcp: {
        title: 'MCP, natively',
        description: (tools: number) =>
          `${tools} tools over both revisions of the protocol, with personal tokens or OAuth. Claude Code, claude.ai and any MCP client write to it.`,
      },
      truth: {
        title: 'One source of truth',
        description:
          'D1 keeps every entry and every revision, append only. Markdown goes in and comes back out byte for byte, never locked in a format of ours.',
      },
      edge: {
        title: 'Read at the edge',
        description:
          'A Worker reads published content over a service binding: no network, no token. Pages stay at the edge, and are purged by tag the moment you publish.',
      },
      people: {
        title: 'People stay in the loop',
        description:
          'Passkeys, roles per site and a review queue: an author’s agent asks to publish, and an editor approves the diff in the admin.',
      },
      yours: {
        title: 'Yours to run',
        description:
          'It deploys to your own Cloudflare account in one command: D1 for your content, R2 for its images, built for the limits of the free plan. MIT licensed, no service in between.',
      },
    },
    steps: {
      headline: 'Three commands',
      title: 'From nothing to live',
      create: {
        title: 'Create a project',
        description:
          'A Worker and a local database, with your site from a preset, its owner and a token.',
      },
      connect: {
        title: 'Connect your agent',
        description:
          'It reads your site with describe_site, then writes, validates and publishes drafts.',
      },
      deploy: {
        title: 'Deploy it',
        description:
          'Hollware creates its database, namespace, queues and image bucket on your account, and migrates.',
      },
    },
    shaping: {
      headline: 'No deploy',
      title: 'Shape your content as you go',
      description:
        'Your collections, their fields and their rules live with your content. Change them in the admin, or let an agent do it over MCP: it says what a change would do to the entries you have, and applies at once.',
      link: 'Configure your content',
      comment: '// An agent adds a required field to the blog, over MCP',
      answer: [
        '// → needs_confirmation: 3 entries have no subtitle.',
        '//   Confirm, and every write after it is checked against it.',
      ],
    },
    cta: {
      title: 'Give your agents a CMS',
      description: 'Running on your own Cloudflare account in a few minutes.',
    },
  },
  docs: {
    label: 'Docs',
    navigation: 'Documentation',
    sections: {
      start: 'Getting started',
      guides: 'Guides',
      concepts: 'Concepts',
      reference: 'Reference',
    },
    previous: 'Previous',
    next: 'Next',
    onThisPage: 'On this page',
    markdown: 'Markdown',
    notFound: 'Page not found',
    empty: 'No docs yet',
    untranslated: '',
    callout: { note: 'Note', tip: 'Tip', warning: 'Warning' },
  },
  tools: {
    title: 'MCP tools',
    description:
      'Every tool of the Hollware MCP server: what it does, the scopes it needs and its input.',
    intro: (tools: number) =>
      `The ${tools} tools of /mcp, as tools/list describes them. A tool checks its scopes when it runs: a token without them gets a 403 that names what is missing.`,
    untranslated: '',
    input: 'Input schema',
  },
}

export type Messages = typeof en
