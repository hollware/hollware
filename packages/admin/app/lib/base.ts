export function adminBase(pathname: string): '' | '/admin' {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? '/admin' : ''
}
