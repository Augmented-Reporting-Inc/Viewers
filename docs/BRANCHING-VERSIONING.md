# Branching & Versioning

## Branching
- **main**: always deployable; only fast-forward from tested release branches or PRs.
- **baseline/***: long-lived maintenance branches (e.g. \aseline/router-v6-pwa-fix\).
- **feat/***, **fix/***, **chore/***, **docs/***, **build/***: short-lived topic branches.
- Prefer **rebase + merge** for clean history (unless a merge commit is intentional).

## Conventional Commits
Use messages like:
- \eat(viewer): add signed URL auth\
- \ix(router): prevent double mount with basename\
- \docs: add release checklist\

This keeps CHANGELOGs & release notes automatable later if we choose.

## Versioning (SemVer)
- **MAJOR.MINOR.PATCH** (e.g. \1.4.2\)
- Bump:
  - breaking change  **MAJOR**
  - new capability  **MINOR**
  - bug fix  **PATCH**

## Git Tags  Docker Tags
When we cut \X.Y.Z\, tag/push images with:
- \X.Y.Z\ (exact)
- \X.Y\ (minor line)
- \X\ (major line)
- \latest\
- \X.Y.Z-<shortsha>\ (traceability)

Example: \1.4.2\  \1.4.2\, \1.4\, \1\, \latest\, \1.4.2-a1b2c3d\

## Router & Asset Base
- Build-time **PUBLIC_URL=/rviewer/** (baked into assets)
- Runtime config mount: bind \pp-config.js\ (with \outerBasename: '/rviewer'\)
