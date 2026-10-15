/** What `create-hollware` replaces with its own version in the template's package.json. */
export declare const VERSION_PLACEHOLDER = 'HOLLWARE_VERSION'
/** Where the template goes, below the repository. */
export declare const TEMPLATE_DIR: string
type Json = Record<string, unknown>
/** The package.json of the template: exact versions, and no workspace or catalog protocol. */
export declare function templateManifest(starter: Json, catalog: Record<string, string>): Json
/** The tsconfig.json of the template: the repository's base options, then the starter's own. */
export declare function templateTsconfig(base: Json, starter: Json): Json
/** Every file of the template, by its path below the template, with its content. */
export declare function starterTemplate(root: string): Map<string, string>
export {}
