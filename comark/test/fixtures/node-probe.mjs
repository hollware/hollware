// A Worker that reports whether Node.js compatibility is on in the runtime it runs in. The
// specifiers are built at run time so no bundler resolves (or rejects) them first.
export default {
  async fetch() {
    const report = { typeofProcess: typeof process, typeofBuffer: typeof Buffer }
    for (const name of ['buffer', 'path', 'fs']) {
      const specifier = ['node', name].join(':')
      try {
        await import(specifier)
        report[specifier] = 'importable'
      } catch {
        report[specifier] = 'rejected'
      }
    }
    return Response.json(report)
  },
}
