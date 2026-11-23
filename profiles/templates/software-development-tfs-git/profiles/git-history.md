# Git commit digest observations

| Digest evidence | Proposed result |
| --- | --- |
| Repository key, declared storage format and full %H | Scoped commit and in_repository |
| Author metadata (%an, %ae, %aI) | authored_by when the author can be attributed |
| Committer metadata (%cn, %ce, %cI) | committed_at from %cI converted to UTC |
| Complete path entry from a declared diff comparison | touches the exact path |
| Complete rename entry | touches both exact paths |
| Binary numstat entry | touches the path, with line counts unavailable |
| Message containing a complete declared tracker reference | references scoped work item |

Keep author time separate from committer time. Preserve comparison scope (such as
first parent) and rename-detection provenance. A digest covers only the paths it
actually provides. A message such as “Fixes WI-19” records a declaration and can
support references. It cannot prove implementation, fixes, review or testing.
