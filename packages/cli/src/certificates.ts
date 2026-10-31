import tls from 'node:tls'

export function trustSystemCertificates(): void {
  let system: string[]
  try {
    system = tls.getCACertificates('system')
  } catch {
    return
  }
  tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...system])])
}
