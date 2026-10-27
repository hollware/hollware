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
    title: 'The CMS your agents write to',
    description:
      'Your agents write your content in Markdown. Hollware checks every change against your rules, lets people approve what goes live, and serves it from Cloudflare’s network seconds after you publish.',
    readDocs: 'Read the docs',
    demo: 'See the demo',
    flow: {
      headline: 'How it works',
      title: 'From a prompt to a live page, with checks in between',
      description:
        'Hollware sits between whoever writes and the site that shows it. Every write takes the same path, whether it comes from an agent, a person in the admin or a script.',
      steps: [
        {
          title: 'An agent writes',
          description:
            'Claude Code, claude.ai or any MCP client reads the structure of your site and writes drafts in Markdown.',
          detail: 'create_draft',
        },
        {
          title: 'Hollware checks',
          description:
            'Each write is checked against the schema and rules of its collection. A draft that fails is saved anyway, with the fix the agent applies next.',
          detail: 'verdict + fix',
        },
        {
          title: 'A person approves',
          description:
            'An agent without permission to publish asks for review. An editor reads the diff in the admin and approves it, or asks for changes.',
          detail: 'request_review',
        },
        {
          title: 'Your site shows it',
          description:
            'Publishing purges the pages that changed. Your site reads the new content over Workers RPC, live in seconds, with no rebuild.',
          detail: 'publish',
        },
      ],
    },
    benefits: {
      headline: 'Why Hollware',
      title: 'Let agents write, and keep control of what is published',
      description:
        'An agent writes fast and gets things wrong. Hollware makes its mistakes cheap: it finds them, explains them and keeps them away from your readers.',
      items: {
        contracts: {
          title: 'Agents can’t break your site',
          description:
            'The schema of your frontmatter, your components and the rules you pick check each draft. What fails never reaches publish, and the agent gets told how to fix it.',
        },
        history: {
          title: 'Every change can be undone',
          description:
            'Each revision is kept, append only. Compare two of them, restore any, bring back a deleted entry from the trash, and get a backup of each day.',
        },
        people: {
          title: 'People decide what goes live',
          description:
            'Passkeys, roles per site and a review queue. A token only does what its scopes allow, and its person still allows today.',
        },
        live: {
          title: 'Live in seconds, no rebuild',
          description:
            'No CI run and no static build to wait for: publishing purges the cached pages by tag, and the next request reads the new version.',
        },
        yours: {
          title: 'Your content stays yours',
          description:
            'Markdown goes in and comes out byte for byte. Export it at any time, and run it on your own account under the MIT license.',
        },
        free: {
          title: 'Free to start',
          description:
            'Built for the limits of Cloudflare’s free plan: a blog or a docs site runs without paying for anything, and with no server to look after.',
        },
      },
    },
    different: {
      headline: 'What makes it different',
      title: 'Built for agents, not adapted to them',
      description:
        'Hollware was designed from the first line for a world where most writes come from an agent and a person has the last word.',
      items: {
        agents: {
          title: 'Agents are first-class users',
          description: (tools: number) =>
            `MCP is the main door, not a plugin: ${tools} tools, scopes on each of them, OAuth or personal tokens, and errors that say how to fix them.`,
        },
        rules: {
          title: 'The rules live with the content',
          description:
            'Collections, fields and rules are data, not code. Change them in the admin or over MCP with no deploy, and an agent learns them with one call.',
        },
        operate: {
          title: 'Nothing to operate',
          description:
            'No server, no container and no database to patch. It is one Worker on your account, and Cloudflare runs it in every region.',
        },
        reads: {
          title: 'Sites read it without a network hop',
          description:
            'Your site is a Worker bound to Hollware: it reads published content Worker to Worker, with no API key to keep on the site.',
        },
      },
    },
    cloudflare: {
      headline: 'Cloudflare native',
      title: 'Each piece is a Cloudflare product',
      description:
        'Hollware is one Worker that puts the platform together. It deploys to your own account in one command, and nothing runs outside it.',
      optional: 'Optional',
      diagram: {
        writers: 'Agents, people and scripts',
        writersVia: 'MCP · HTTP · admin',
        hollware: 'Hollware, one Worker',
        site: 'Your site, a Worker',
        siteVia: 'service binding · RPC',
        readersVia: 'HTTPS · edge cache',
        readers: 'Readers, from the closest location',
      },
      products: {
        workers: 'The CMS, its MCP server, its HTTP API and the sign-in, in one Worker.',
        d1: 'Entries, every revision, people and the audit log: the single source of truth.',
        r2: 'Images and their originals, and a backup of each day.',
        images: 'Resizes each image to the widths of its srcset.',
        rpc: 'Your site reads published content Worker to Worker, with no token.',
        cache: 'Keeps pages at the edge, and drops them by tag when you publish.',
        queues: 'Delivers webhooks and events, with retries and a dead letter queue.',
        cron: 'Publishes what you scheduled and runs the daily backup.',
        kv: 'Keeps the OAuth grants of the agents you connect.',
        assets: 'Serves the admin, built ahead, without waking the Worker.',
        ai: 'Semantic search and related entries, across languages.',
        analytics:
          'Reads the views the site already measures, here or in PostHog, Plausible or GA4, so agents know what to refresh.',
      },
    },
    cases: {
      headline: 'Use cases',
      title: 'One CMS, many ways to work',
      description:
        'The same pieces fit a blog of one person, a team with editors or docs that agents keep current.',
      items: [
        {
          label: 'A personal blog',
          title: 'You write with your agent',
          description:
            'Ask for a post in your own words. The agent drafts it, fixes what the rules flag, and you publish from the admin or from the chat.',
          steps: [
            'Ask Claude Code for a post about what you built this week',
            'It drafts in Markdown and fixes what the contracts flag',
            'You read the preview on your own site',
            'You publish, and it is live in seconds',
          ],
        },
        {
          label: 'A team with editors',
          title: 'Authors write, editors approve',
          description:
            'Each author’s agent can write but not publish. Editors review the queue from the admin, on the desk or the phone.',
          steps: [
            'An author’s agent writes a draft and asks for review',
            'The editor reads the diff, the verdict and who wrote it',
            'They approve it, or comment and ask for changes',
            'A new revision needs a new approval',
          ],
        },
        {
          label: 'Docs kept current',
          title: 'Docs that follow the code',
          description:
            'hollware.com works this way: its pages are written in Hollware by agents with a token that cannot publish, and approved by a person.',
          steps: [
            'A change ships in the code',
            'An agent updates the pages it touches, in each language',
            'Internal links must resolve before publishing',
            'Approved pages, and their llms.txt, update on their own',
          ],
        },
        {
          label: 'Many languages',
          title: 'Each language, one entry group',
          description:
            'Translations of a page are linked entries. An agent translates, and a rule can hold a page until every language is there.',
          steps: [
            'You publish a page in English',
            'A translator agent writes the Spanish draft, linked to it',
            'The translation pair rule checks that both exist',
            'Your site switches language with the right alternates',
          ],
        },
        {
          label: 'Content that improves',
          title: 'Refresh what readers read',
          description:
            'Hollware reads the analytics the site already has. An agent sees what is popular and out of date, finds the related pages and proposes an update.',
          steps: [
            'content_stats shows the pages read the most',
            'An auditor agent flags the ones that are out of date',
            'Semantic search finds what else to update',
            'The new draft goes through the same review',
          ],
        },
        {
          label: 'Moving in',
          title: 'Bring the Markdown you have',
          description:
            'Import a folder of Markdown or a Nuxt Content site. Every file keeps its bytes, and it comes back out the same way.',
          steps: [
            'hollware import reads your files',
            'Drafts first, then publish, and a second run changes nothing',
            'Your site reads them with the Nuxt, Astro, React or Vue package',
            'hollware export gives the files back whenever you want',
          ],
        },
      ],
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
