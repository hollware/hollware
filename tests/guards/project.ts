/**
 * Facts about the project that several guards bind to files. They are literals on purpose:
 * a guard that recomputed them from the files it checks could never disagree with them.
 */

export const GITHUB_REPOSITORY = 'hollware/hollware'

/** The `repository.url` of every published package. */
export const REPOSITORY_URL = 'git+https://github.com/hollware/hollware.git'

export const HOMEPAGE_URL = 'https://hollware.com'

export const ISSUES_URL = 'https://github.com/hollware/hollware/issues'

/** Where GitHub's private vulnerability reporting takes a report. */
export const ADVISORY_URL = 'https://github.com/hollware/hollware/security/advisories/new'

/** Where reports of misconduct go. */
export const CONDUCT_EMAIL = 'conduct@hollware.com'
