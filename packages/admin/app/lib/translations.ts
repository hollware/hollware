type Dated = { readonly createdAt: string }

export function sourceWhenTranslated<R extends Dated>(
  newestFirst: readonly R[],
  translatedAt: string,
): R | undefined {
  return newestFirst.find((revision) => revision.createdAt <= translatedAt)
}
