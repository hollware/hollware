/// <reference types="astro/client" />
import type { HollwarePreviewLocals } from '@hollware/astro'

declare global {
  namespace App {
    // `hollwarePreview` and `hollwarePreviewRefused`, which src/middleware.ts sets.
    interface Locals extends HollwarePreviewLocals {}
  }
}
