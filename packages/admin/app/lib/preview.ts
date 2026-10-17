/**
 * The page the preview of a draft shows (T-60): the HTML Hollware renders, in an iframe with an
 * empty `sandbox`, so it runs no script, reaches nothing of the admin, and whatever its styles do
 * stays inside its frame: a draft cannot draw over the admin's buttons. It sends no referrer to
 * the hosts of its images. Its look is the admin's, dark, with nothing to fetch.
 */

const STYLE = `:root{color-scheme:dark}body{margin:0;padding:1rem;background:#0a0a0a;color:#e5e5e5;font:15px/1.65 system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:anywhere}
h1,h2,h3,h4{color:#fafafa;line-height:1.25;margin:1.4em 0 .5em}h1{font-size:1.8rem}h2{font-size:1.4rem}h3{font-size:1.15rem}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}a{color:#34d399}img{max-width:100%;height:auto}
code{font:.88em ui-monospace,'SF Mono',Menlo,monospace;background:#171717;padding:.1em .3em;border-radius:4px}
pre{background:#171717;padding:.8rem;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
blockquote{border-left:3px solid #404040;margin-left:0;padding-left:1rem;color:#a3a3a3}
table{border-collapse:collapse}th,td{border:1px solid #262626;padding:.35rem .6rem}`

/** A locale as `lang` takes it, such as `es-CL`; anything else is `und`, undetermined. */
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** The `srcdoc` of the preview: the rendered HTML, as it is, in a page of its own. */
export function previewDocument(html: string, locale: string): string {
  return `<!doctype html><html lang="${LANG.test(locale) ? locale : 'und'}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>${STYLE}</style></head><body>${html}</body></html>`
}
