/** The images page (ADR-038): what turns a file into what `upload_asset` takes, and sizes. */

/** A file as base64, without the `data:` prefix that `FileReader` puts first. */
export function base64OfFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** A size in bytes as a person reads it: 812 B, 48 KB, 1.4 MB. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
