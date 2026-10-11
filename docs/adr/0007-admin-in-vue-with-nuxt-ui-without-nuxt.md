# ADR-007: Admin in Vue 3.5 with Nuxt UI 4, without Nuxt

Status: Accepted (2026-10-11)

## Context

The admin exists to review and approve what agents write, and everything it does must also be possible over MCP. It still needs a real interface: an entry list, an editor, forms, a diff and an approval queue, all of it accessible.

Nuxt UI covers most of that with accessible components: dashboard layouts, tables, a command palette, forms (`UForm`) that validate with Standard Schema and can therefore reuse the Zod contracts, and chat components for the intelligence phase. `@comark/vue` previews the Markdown. The admin is a single-page app served as static assets of the Worker, so it does not need the server side of Nuxt.

## Decision

The admin is a Vue 3.5 app built with Nuxt UI 4 (4.11), used as a Vite plugin (`@nuxt/ui/vite`) without Nuxt, and with Vue Router 5. It compiles to static files that ship inside `@hollware/admin` and are served by the Worker.

The editor starts in source mode with CodeMirror 6: exact Markdown, with autocompletion for the components the contract allows, and a Comark preview. A visual mode based on `UEditor` (TipTap) may come later, and only if it never alters the Markdown.

## Consequences

- Forms validate with Standard Schema, so the admin reuses the contracts instead of redefining the rules.
- The admin ships prebuilt and static, with no admin code in the Worker bundle, and users do not need a Vue toolchain to run it.
- Source mode keeps the Markdown byte-exact: opening an entry and saving it without changes leaves the same bytes and creates no revision. A visual editor would have to meet the same bar.
- Nuxt UI is designed for Nuxt, and using its Vite plugin on Vite+ with a single Vite instance is not yet proven. A spike at the start of v0.3 checks it, with plain Vite for this package (recorded in an ADR) as the fallback.
- Vue has a smaller pool of potential external contributors than React.

## Alternatives considered

- React, which would have maximized the number of potential external contributors. Not chosen: Nuxt UI gives most of the admin ready-made.
- Nuxt as the admin framework. Not needed: the admin is a static single-page app, and Nuxt UI works as a Vite plugin without it.
- A visual (WYSIWYG) editor first. Not chosen: it risks rewriting the Markdown that agents wrote.
