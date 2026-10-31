# @hollware/admin

The review and approval UI. Boundary rules for this package:

- It is a prebuilt single-page app: the package ships built assets and nobody compiles it
  in their own project.
- It never enters the Worker bundle: Worker code never imports it.
- Never read `process.env`: configuration arrives as arguments.
- Its look is the theme it shares with the site (`app/app.css`): amber is the secondary color, one amber action per
  page; a button with no color of its own is the warm white of the primary.
- The editor is visual, Linear-like, and writes Markdown only through `stringifyBody`, the writer the
  server stores every write with: opening and saving an entry changes no byte, and a file it cannot
  keep byte for byte opens as Markdown (`tests/editor.test.ts`). Nothing it does not know is
  dropped: it stays a Markdown block.
- An entry's page holds one amber action, Publish; every other action of the entry is in its `⋯` menu,
  and every action has a name and a shortcut or a menu, never only a hover.
- Fonts and icons travel in the bundle (`vite.app.config.ts` finds the Lucide icons the app names):
  the admin's policy lets it fetch nothing from another origin.
- The type-check of the repository does not read single-file components, only the build does: logic
  goes in `app/lib/`, where the tests and the type-check reach it.
- What the server holds is read with `useQuery` of Pinia Colada (`operation`, `admin` of
  `app/lib/queries.ts`), never into a page's own `ref`: every write invalidates every query, so no page
  reloads by hand, and a form keeps its own copy, which a refetch never overwrites while it has edits.
- It lives on the Worker's own origin, at `/admin` or at `/` (`admin.path`), and never on a path of a
  site's domain: it keeps its token in `sessionStorage`, which any script of that origin can read.
