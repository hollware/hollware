---
'hollware': patch
---

`promote` keeps the tree of a nested collection. It created every entry at the root of the destination, in the order the source listed them, so a child lost its parent, the links to its path broke, and siblings changed places. It now creates parents before their children, creates each entry under the parent it has in the source, and moves an entry the destination holds to the parent and the place among its siblings it has there. The state remembers that place, so an entry that only moved in the source is promoted on the next run, and a dry run names each entry that moves. A published entry that goes under a parent the same run creates waits for the review to publish that parent and moves on the next run; a parent a filter leaves out is promoted when the destination lacks it; and a nested collection is read whole on an incremental run, since a move in the source shifts siblings without changing them.
