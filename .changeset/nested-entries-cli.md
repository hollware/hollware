---
'hollware': minor
---

`hollware import --from notion` into a nested collection keeps the tree of Notion: each page goes under its parent, the pages below the root at the root, in their order, and links point at the whole path; a page deeper than the collection allows stops the import before anything is written. `hollware import` reads a folder below the locale as the parent of its files, checks that each folder has its entry, and moves an entry that is already there to the parent its folder says. `hollware export` and `hollware backup get` write a nested entry in the folders of its ancestors and the order of siblings in `_order.json`, which an import follows, so an export imports back as the same tree; without that file, the order on the site stays as it is.
