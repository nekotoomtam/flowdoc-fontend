# Oracle Lab Editor runtime

## Authority Boundary

Owner: flowdoc-fontend. Scope: the lab host and worker files used by this
Editor checkout. Project Control owns release and cross-repository acceptance.

The built Editor and library match the files served through port 5193.
When staging the two Lab processes, overlay `main/scripts` or
`eagletainer/scripts` on the scripts directory. Use the tracked worker scripts
as the base for `/phase1`, overlay `common/worker`, then overlay the matching
profile's worker directory. Both profiles use the same built client.
The Eagletainer host runs on loopback port 5200. The main host routes that draft
to it and serves the other drafts directly.

`runtime-sha256.json` records the captured overlay bytes. Existing demo assets,
sample upstream credentials, font files, databases, and publication assets come
from the Lab mounts. Supply them separately when restoring a host.
