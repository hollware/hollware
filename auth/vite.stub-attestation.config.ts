import { cloudflare } from '@cloudflare/vite-plugin'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

// EXPERIMENT, not part of the answer: the same Worker with parts of @simplewebauthn/server cut out
// by aliasing its internal modules, to see what that code weighs.
//
//   SPIKE_VARIANT=barrel-only|stub-only|all vp build -c vite.stub-attestation.config.ts --outDir dist-<x>
//
// - barrel-only: verifyOKP.js and verifyAKP.js of the library import `isoBase64URL` from
//   '../../index.js', which is helpers/index.js (the whole barrel: certificates, MDS, attestation
//   helpers) and not helpers/iso/index.js, the one they mean (verifyEC2.js and verifyRSA.js say
//   '../index.js'). Pointing them at the right file takes the barrel out of the module graph.
// - stub-only: the attestation format verifiers (everything but "none"), the X.509 public key
//   conversion, the metadata service and the default root certificates become stubs.
// - all: both.
const stub = (name: string) =>
  fileURLToPath(new URL(`./experiments/stub-attestation/${name}.ts`, import.meta.url))

const isoBarrel = realpathSync(
  fileURLToPath(
    new URL('./node_modules/@simplewebauthn/server/esm/helpers/iso/index.js', import.meta.url),
  ),
)

const variant = process.env.SPIKE_VARIANT ?? 'all'
const fixBarrel = variant === 'barrel-only' || variant === 'all'
const stubAttestation = variant === 'stub-only' || variant === 'all'

// `find` regexes cover the WHOLE specifier: Vite replaces only the matched part of it.
const barrelAlias = [{ find: /^\.\.\/\.\.\/index\.js$/, replacement: isoBarrel }]
const attestationAliases = [
  {
    find: /^(?:\.{1,2}\/)+verifications\/(?:tpm\/)?verifyAttestation(?:Packed|AndroidSafetyNet|TPM|AndroidKey|Apple|FIDOU2F)\.js$/,
    replacement: stub('attestation-stub'),
  },
  {
    find: /^(?:\.{1,2}\/)+(?:helpers\/)?convertX509PublicKeyToCOSE\.js$/,
    replacement: stub('x509-stub'),
  },
  { find: /^(?:\.{1,2}\/)+(?:services\/)?metadataService\.js$/, replacement: stub('empty-stub') },
  { find: /^(?:\.{1,2}\/)+defaultRootCerts\/[a-z-]+\.js$/, replacement: stub('root-certs-stub') },
]

export default defineConfig({
  resolve: {
    alias: [...(fixBarrel ? barrelAlias : []), ...(stubAttestation ? attestationAliases : [])],
  },
  plugins: [cloudflare({ configPath: './wrangler.jsonc' })],
})
