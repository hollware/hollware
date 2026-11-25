---
'@hollware/admin': minor
---

The visual editor builds pages out of the components a collection declares. A component's props open as a form made from their JSON Schema: a list for an enum, a switch for a boolean, a number field, the image picker for an asset, a text area for long text, with required props checked and defaults shown; numbers and booleans are written as bound props, and a prop the schema does not know stays editable as written. Each component block has a menu, with shortcuts, to duplicate it, move it up or down, delete it, add one more of the items it repeats (a `card` of `capabilities`, from its example) and insert another component inside it, chosen in a large dialog that searches the components by name and description; nested components show inside their parent and drag within it. Inline components such as `:mark[Skyward]{tone="serif"}` show as chips whose text and props open in a popover, and the bubble menu wraps the selected words in a component.
