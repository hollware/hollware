# Examples

Projects that use Hollware the way a real one would. Each directory is a project of its own; the
sites read the published content of the playground (`apps/playground`), over a service binding or
over HTTP, and `vp run e2e:integrations` builds and checks them.

| Example             | What it is                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `worker-site`       | A blog on a plain Worker: a listing by locale and tag, and the HTML of an entry, over Workers RPC.                       |
| `nuxt-blog`         | A Nuxt blog through `@hollware/nuxt`, with previews and pages purged by Hollware's webhook: demo.hollware.com.           |
| `astro-blog`        | An Astro blog through the content loaders of `@hollware/astro`.                                                          |
| `react-router-blog` | A React Router blog through `@hollware/react`.                                                                           |
| `agents-worker`     | The Worker of `@hollware/agents` (a reviewer, a translator and an auditor that never publish) for the playground's blog. |
