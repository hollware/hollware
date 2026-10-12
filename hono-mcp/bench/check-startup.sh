#!/bin/sh
# `wrangler check startup` on each built Worker, three times each. The Cloudflare Vite plugin writes
# .wrangler/deploy/config.json on every build and wrangler follows it, so each Worker is rebuilt right
# before its checks. Run with WRANGLER_SEND_METRICS=false.
cd "$(dirname "$0")/.." || exit 1
check() {
  label="$1"; vite_config="$2"; wrangler_config="$3"
  echo "=== $label"
  if [ -n "$vite_config" ]; then ../../node_modules/.bin/vp build --config "$vite_config" > /dev/null 2>&1; else ../../node_modules/.bin/vp build > /dev/null 2>&1; fi
  for i in 1 2 3; do
    ../../node_modules/.bin/wrangler check startup -c "$wrangler_config" --outfile ".wrangler/startup-$label-$i.cpuprofile" 2>&1 \
      | grep -E "Bundle:|Profile window|Active:" | tr -s ' │' ' ' | tr '\n' ' '
    echo
  done
}
check mcp-zod "" dist/spike_hono_mcp/wrangler.json
check mcp-precomputed vite.precomputed.config.ts dist-precomputed/spike_hono_mcp_precomputed/wrangler.json
check hono-only vite.hono-only.config.ts dist-hono-only/spike_hono_only/wrangler.json
