# @hollware/admin

The review and approval UI. Boundary rules for this package:

- It is a prebuilt single-page app: the package ships built assets and nobody compiles it
  in their own project.
- It never enters the Worker bundle: Worker code never imports it.
- Never read `process.env`: configuration arrives as arguments.
- Its look is the theme it shares with the site (`app/app.css`): amber is the secondary color, one amber action per
  page; a button with no color of its own is the warm white of the primary.
- A visual editor is welcome only if it never changes the bytes of the Markdown.
