/// <reference types="astro/client" />
import type { HollwarePreviewLocals } from '@hollware/astro'

declare global {
  namespace App {
    interface Locals extends HollwarePreviewLocals {}
  }
}
