#!/bin/sh
# Three runs of bench/cpu.ts under the workerd condition (what the Worker runs) and three under
# Node's defaults (Ajv validator, no preload), for contrast. Aggregate: node bench/aggregate-cpu.mjs
cd "$(dirname "$0")/.." || exit 1
for i in 1 2 3; do
  node --expose-gc --conditions=workerd bench/cpu.ts "workerd-run$i" > "bench/results/cpu-workerd-run$i.txt" 2>&1 || exit 1
done
for i in 1 2 3; do
  node --expose-gc bench/cpu.ts "nodedefault-run$i" > "bench/results/cpu-nodedefault-run$i.txt" 2>&1 || exit 1
done
node bench/aggregate-cpu.mjs
