#!/bin/bash
# Everything S5c claims, measured again from a clean build, one command, every command printed.
#
#   scripts/measure-all.sh            (from apps/spike-auth; takes a few minutes; ports 5240-5241)
#
# 1. builds the Worker six ways (strict or nodejs_compat, plain or minified, and the pruned
#    experiment) with Vite+;
# 2. prints the size wrangler itself reports (Total Upload / gzip) for those six and for wrangler's
#    own esbuild bundling of the source;
# 3. profiles the startup of each with `wrangler check startup`, three times;
# 4. runs the whole ceremony against the built Worker in plain workerd (wrangler dev);
# 5. asks a Worker (GET /runtime) which Node.js globals each compatibility flag combination gives.
#
# Anonymous telemetry stays off. Each dev server is started and stopped by with-dev-server.sh,
# which stops only the processes it started.
set -u
export WRANGLER_SEND_METRICS=false
cd "$(dirname "$0")/.." || exit 1
VP=../../node_modules/.bin/vp
WR=../../node_modules/.bin/wrangler
BUNDLES=.wrangler/bundles
mkdir -p "$BUNDLES" .wrangler/startup-logs

say() { echo "+ $*"; }

echo "## 1. builds (vp build)"
say "$VP" build
"$VP" build 2>&1 | grep -E "index.js|rror"
say "$VP" build --minify --outDir dist-minified
"$VP" build --minify --outDir dist-minified 2>&1 | grep -E "index.js|rror"
say "$VP" build -c vite.nodejs-compat.config.ts --outDir dist-compat
"$VP" build -c vite.nodejs-compat.config.ts --outDir dist-compat 2>&1 | grep -E "index.js|rror"
say "$VP" build -c vite.nodejs-compat.config.ts --minify --outDir dist-compat-minified
"$VP" build -c vite.nodejs-compat.config.ts --minify --outDir dist-compat-minified 2>&1 | grep -E "index.js|rror"
say env SPIKE_VARIANT=all "$VP" build -c vite.stub-attestation.config.ts --outDir dist-pruned
SPIKE_VARIANT=all "$VP" build -c vite.stub-attestation.config.ts --outDir dist-pruned 2>&1 | grep -E "index.js|rror"
say env SPIKE_VARIANT=all "$VP" build -c vite.stub-attestation.config.ts --minify --outDir dist-pruned-minified
SPIKE_VARIANT=all "$VP" build -c vite.stub-attestation.config.ts --minify --outDir dist-pruned-minified 2>&1 | grep -E "index.js|rror"
say cmp dist/hollware_spike_auth/index.js dist-compat/hollware_spike_auth_compat/index.js
cmp dist/hollware_spike_auth/index.js dist-compat/hollware_spike_auth_compat/index.js && echo "  the strict and the nodejs_compat bundles are byte-identical"

# name | wrangler config | extra args
VARIANTS=(
  "strict-vite|dist/hollware_spike_auth/wrangler.json|"
  "strict-vite-min|dist-minified/hollware_spike_auth/wrangler.json|"
  "compat-vite|dist-compat/hollware_spike_auth_compat/wrangler.json|"
  "compat-vite-min|dist-compat-minified/hollware_spike_auth_compat/wrangler.json|"
  "pruned-vite|dist-pruned/hollware_spike_auth/wrangler.json|"
  "pruned-vite-min|dist-pruned-minified/hollware_spike_auth/wrangler.json|"
  "strict-esbuild|wrangler.jsonc|"
  "strict-esbuild-min|wrangler.jsonc|--minify"
  "compat-esbuild|wrangler.nodejs-compat.jsonc|"
  "compat-esbuild-min|wrangler.nodejs-compat.jsonc|--minify"
)

echo
echo "## 2. size as wrangler reports it (wrangler deploy --dry-run)"
for entry in "${VARIANTS[@]}"; do
  IFS='|' read -r name config extra <<<"$entry"
  say "$WR" deploy --dry-run -c "$config" $extra --outfile "$BUNDLES/$name.bundle"
  printf '  %-20s' "$name"
  # shellcheck disable=SC2086
  "$WR" deploy --dry-run -c "$config" $extra --outfile "$BUNDLES/$name.bundle" 2>&1 | grep -E "Total Upload|rror"
done

echo
echo "## 3. startup (wrangler check startup --workerBundle), 3 runs: Active CPU ms of the startup phase"
for entry in "${VARIANTS[@]}"; do
  IFS='|' read -r name _ _ <<<"$entry"
  say "$WR" check startup --workerBundle "$BUNDLES/$name.bundle" --outfile ".wrangler/startup-logs/$name-N.cpuprofile"
  printf '  %-20s' "$name"
  for run in 1 2 3; do
    "$WR" check startup --workerBundle "$BUNDLES/$name.bundle" --outfile ".wrangler/startup-logs/$name-$run.cpuprofile" 2>&1 \
      | grep -E "Active:" | sed -E 's/.*Active: ([0-9.]+) ms.*/\1/' | tr '\n' ' '
  done
  echo
done

echo
echo "## 4. the ceremony against the built Worker in plain workerd"
ceremony() { # <label> <wrangler args> <node.js compat: on|off> [pruned]
  echo "-- $1"
  say scripts/with-dev-server.sh 5240 /runtime "$2" -- node scripts/e2e-built-worker.ts "${@:3}"
  scripts/with-dev-server.sh 5240 /runtime "$2" -- node scripts/e2e-built-worker.ts "${@:3}" 2>&1 | grep -E "ok 1 |ok 2 |ok 3 |ok 13 |checks passed|rror"
}
ceremony "strict build (no_nodejs_compat + no_nodejs_compat_v2), Vite+" "-c dist/hollware_spike_auth/wrangler.json" off
ceremony "strict build, Vite+ minified" "-c dist-minified/hollware_spike_auth/wrangler.json" off
ceremony "strict, bundled from source by wrangler's esbuild" "-c wrangler.jsonc" off
ceremony "pruned build (attestation formats other than none stubbed out), minified" "-c dist-pruned-minified/hollware_spike_auth/wrangler.json" off pruned
echo "-- vp dev (the Vite module runner in workerd, nothing bundled; port 5242)"
say env SPIKE_SERVER=vp scripts/with-dev-server.sh 5242 /runtime "" -- node scripts/e2e-built-worker.ts off
SPIKE_SERVER=vp scripts/with-dev-server.sh 5242 /runtime "" -- node scripts/e2e-built-worker.ts off 2>&1 | grep -E "ok 1 |ok 2 |ok 3 |ok 13 |checks passed|rror"
ceremony "nodejs_compat flag on, Vite+" "-c dist-compat/hollware_spike_auth_compat/wrangler.json" on
ceremony "the literal config of the brief (date only, no flags): Node.js compat comes ON by itself" "-c wrangler.literal.jsonc" on

echo
echo "## 5. which Node.js a Worker gets: globals and node: imports (GET /runtime of wrangler.literal.jsonc: date 2026-10-06, no flags, plus:)"
probe() {
  say scripts/with-dev-server.sh 5240 /runtime "-c wrangler.literal.jsonc $1" -- curl "\$SPIKE_URL/runtime"
  printf '  %-92s' "[$1]"
  scripts/with-dev-server.sh 5240 /runtime "-c wrangler.literal.jsonc $1" -- sh -c 'curl -sS "$SPIKE_URL/runtime"; echo' 2>/dev/null
}
probe ""
probe "--compatibility-flags no_nodejs_compat"
probe "--compatibility-flags no_nodejs_compat_v2"
probe "--compatibility-flags no_nodejs_compat --compatibility-flags no_nodejs_compat_v2"
probe "--compatibility-date 2026-07-01"
probe "--compatibility-date 2026-07-01 --compatibility-flags nodejs_compat"
probe "--compatibility-date 2026-07-01 --compatibility-flags nodejs_compat_v2"
