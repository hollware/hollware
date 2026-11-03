export const en = {
  language: { name: 'English', switch: 'Leer en español', switchTo: 'Español' },
  seo: {
    home: 'Hollware: the CMS your agents write to',
    description:
      'Hollware is an open-source headless CMS on Cloudflare Workers. Agents write Markdown over MCP, contracts check every write, and your sites read it over Workers RPC.',
  },
  nav: {
    docs: 'Docs',
    features: 'Features',
    compare: 'Compare',
    mediaKit: 'Media kit',
    tools: 'Tools',
    demo: 'Demo',
    github: 'Hollware on GitHub',
  },
  footer: { license: 'Open source, MIT', by: 'Made by', author: 'Sergio Azócar' },
  pages: {
    notFound: 'Page not found',
    unavailable: 'Hollware is not answering right now: try again in a minute',
    untranslated: '',
    markdown: 'Markdown',
    features: 'Features',
    compare: 'Compare',
    glossary: 'Glossary',
    home: 'Home',
    reviewed: (date: string) => `Sources read on ${date}`,
    sources: 'Sources',
    empty: 'Nothing here yet',
    install: {
      button: 'Install it with your agent',
      copied: 'Copied: paste it into your agent',
      agents: 'Agents',
      claude: 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      other: 'Other',
      paste: 'Paste it into the chat of the agent:',
      terminal: 'Run it in the terminal of the project:',
      manual: 'Or by hand:',
    },
    session: 'An agent writes to Hollware',
    copyText: 'Copy',
    copiedText: 'Copied',
    brand: {
      mark: 'Mark',
      wordmark: 'Mark and name',
      onDark: 'On dark',
      onLight: 'On light',
      svg: 'SVG',
      png: 'PNG',
      colors: 'Colors',
      fonts: 'Fonts',
      carbon: 'Carbon',
      flame: 'Flame',
      sans: 'Text',
      mono: 'Code',
      sansName: 'Schibsted Grotesk',
      monoName: 'JetBrains Mono',
    },
  },
  docs: {
    label: 'Docs',
    navigation: 'Documentation',
    sections: {
      start: 'Getting started',
      guides: 'Guides',
      frameworks: 'Frameworks',
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
  readApi: {
    title: 'Read API',
    description:
      'Every endpoint of the read API of Hollware: what it answers and the parameters it takes.',
    intro: (endpoints: number) =>
      `The ${endpoints} endpoints of /v1, which a site outside Cloudflare reads with a read token. Each answers JSON with an ETag, and 304 when nothing changed since; a preview token reads the latest revision of one entry. A deployment serves the same, as OpenAPI, at /v1/openapi.json.`,
    untranslated: '',
    answers: 'Answers:',
    parameter: 'Parameter',
    in: 'In',
    about: 'What it is',
  },
  events: {
    title: 'Webhook events',
    description:
      'Every event a webhook of Hollware gets: when it is sent, its fields, and how to verify it.',
    intro:
      'A site lists its webhooks in its events. Each change sends an event to each of them, as JSON in a POST, signed with the secret of the webhook. parseHollwareEvent of @hollware/core reads one, and verifyWebhook checks its signature.',
    untranslated: '',
    delivery: 'Delivery',
    deliveryBody:
      'An event is written in the same batch as the change it tells of, then sent through the Queue: a webhook that answers an error gets it again, up to five times. The events of a review reach the webhooks at the next sweep of the cron, within a minute. A receiver uses the id of an event to ignore one it already has.',
    eventHeader: 'the id of the event, the same on every retry',
    timestampHeader:
      'when it was signed, in seconds; verifyWebhook refuses one more than five minutes away',
    signatureHeader:
      'v1= and the HMAC-SHA256 of the timestamp, a dot and the body, under the secret of the webhook',
    field: 'Field',
    type: 'Type',
    about: 'What it is',
  },
  tools: {
    title: 'MCP tools',
    description:
      'Every tool of the Hollware MCP server: what it does, the scopes it needs and its input.',
    intro: (tools: number) =>
      `The ${tools} tools of /mcp, as tools/list describes them to a client with every scope. A personal token lists only the tools its scopes allow, and an OAuth client lists them all; a call without the scope gets a 403 that names what is missing.`,
    untranslated: '',
    input: 'Input schema',
  },
}

export type Messages = typeof en
