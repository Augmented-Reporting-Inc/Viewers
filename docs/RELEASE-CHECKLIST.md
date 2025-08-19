# Release Checklist

1) **Branch is green**
   - On \aseline/... \ or topic branch, \git status\ is clean.
   - Viewer loads locally and via reverse proxy at \/rviewer\.

2) **Pick a version (\X.Y.Z\)**
   - PATCH for fixes, MINOR for features, MAJOR for breaking changes.

3) **Build & tag**
   - Build with **PUBLIC_URL=/rviewer/**.
   - Tag images: \X.Y.Z\, \X.Y\, \X\, \latest\, \X.Y.Z-<sha>\.

4) **Push images**
   - Push to ECR repo.
   - Update compose to new tag where needed.

5) **Git tag & push**
   - \git tag -a vX.Y.Z -m "viewer X.Y.Z"\
   - \git push --tags\

6) **Verify**
   - Smoke test via reverse proxy at \/rviewer\.
   - Confirm DICOMweb endpoints reachable.

> Tip: use \scripts/release.ps1\ to automate steps 35.
