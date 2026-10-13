# CI delivery environment corrections

The first remote Windows run for source `33f66a1` failed 2 of 67 integration tests:

- Effect-chain integration could not access `out/main/index.js`: integration ran before the existing build step.
- File symlink replacement compared the canonical `runneradmin` destination with the `RUNNER~1` temporary-path alias at line 120.

The existing integration step now follows the Windows installer build and packaged-resource check. No extra build was added. The audio-export lifecycle fixture canonicalizes its newly created temporary directory with `realpath`; assertions, timeouts, and symlink protection remain unchanged.

Validation: inspected the targeted diff; `git diff --check` passed. Local suites and builds are deliberately not repeated: runtime behavior and the earlier local full/installed tests already passed. The next existing remote Windows workflow must verify these two CI-specific failures. Remote verification is pending; this checkpoint does not claim a passing remote run.

## Second remote run: explicit build-only publishing policy

Run [38329297935](https://github.com/tallelella1/music-workbench/actions/runs/38329297935), source `9cf9bc477a8d4100c727b82dc175f21cff0248b8`, passed pinned media restoration, 79 unit tests, media checks, typecheck, compilation and NSIS installer creation. It then failed because electron-builder 26.15.3 inferred publishing from the CI environment and required `GH_TOKEN`. The raw job log is retained in `github-ci-second.log`.

The workflow now passes `--publish never` to its existing `dist:win` command. The installed dependency's CLI accepts this option and `PublishManager` excludes automatic publishing when it is set. This keeps CI limited to building and artifact verification; publication remains the authorized manual release operation. No token, extra build step, product code change, local test rerun or local installer rebuild was added. The next remote run verifies this environment correction.
