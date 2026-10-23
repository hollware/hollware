const STYLE = `:root{color-scheme:dark}body{margin:0;padding:1rem;background:#0e0c0a;color:#e6dfd3;font:15px/1.65 system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:anywhere}
h1,h2,h3,h4{color:#f2ede4;line-height:1.25;margin:1.4em 0 .5em}h1{font-size:1.8rem}h2{font-size:1.4rem}h3{font-size:1.15rem}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}a{color:#f0a93b}img{max-width:100%;height:auto}
code{font:.88em ui-monospace,'SF Mono',Menlo,monospace;background:#17140f;padding:.1em .3em;border-radius:4px}
pre{background:#17140f;padding:.8rem;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}
blockquote{border-left:3px solid #433e37;margin-left:0;padding-left:1rem;color:#9e968a}
table{border-collapse:collapse}th,td{border:1px solid #2a251d;padding:.35rem .6rem}`

const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

export function previewDocument(html: string, locale: string): string {
  return `<!doctype html><html lang="${LANG.test(locale) ? locale : 'und'}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>${STYLE}</style></head><body>${html}</body></html>`
}
