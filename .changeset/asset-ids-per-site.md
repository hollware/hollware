---
'@hollware/core': patch
'@hollware/server': patch
'hollware': patch
---

The same image uploaded to two sites of one deployment is two assets, each with an id of its site and its bytes; with rc.2 the second upload failed with a server error and left its files in R2. Assets uploaded before keep their ids and are found by their bytes. `hollware import` of an export into another site writes the `asset:` references with the ids that site gives.
