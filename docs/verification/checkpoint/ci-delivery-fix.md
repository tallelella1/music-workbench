# CI delivery environment corrections

The first remote Windows run for source `33f66a1` failed 2 of 67 integration tests:

- Effect-chain integration could not access `out/main/index.js`: integration ran before the existing build step.
- File symlink replacement compared the canonical `runneradmin` destination with the `RUNNER~1` temporary-path alias at line 120.

The existing integration step now follows the Windows installer build and packaged-resource check. No extra build was added. The audio-export lifecycle fixture canonicalizes its newly created temporary directory with `realpath`; assertions, timeouts, and symlink protection remain unchanged.

Validation: inspected the targeted diff; `git diff --check` passed. Local suites and builds are deliberately not repeated: runtime behavior and the earlier local full/installed tests already passed. The next existing remote Windows workflow must verify these two CI-specific failures. Remote verification is pending; this checkpoint does not claim a passing remote run.

## Second remote run: explicit build-only publishing policy

Run [38329297935](https://github.com/tallelella1/music-workbench/actions/runs/38329297935), source `9cf9bc477a8d4100c727b82dc175f21cff0248b8`, passed pinned media restoration, 79 unit tests, media checks, typecheck, compilation and NSIS installer creation. It then failed because electron-builder 26.15.3 inferred publishing from the CI environment and required `GH_TOKEN`. The raw job log is retained in `github-ci-second.log`.

The workflow now passes `--publish never` to its existing `dist:win` command. The installed dependency's CLI accepts this option and `PublishManager` excludes automatic publishing when it is set. This keeps CI limited to building and artifact verification; publication remains the authorized manual release operation. No token, extra build step, product code change, local test rerun or local installer rebuild was added. The next remote run verifies this environment correction.

## Third remote run: startup and import fixture prerequisites

Run [38329912973](https://github.com/tallelella1/music-workbench/actions/runs/38329912973), source `9492eaa091e77ae9940c1f07e42a5f50de6d2ded`, passed all 79 unit tests, all 67 integration tests, typecheck, installer build and packaged-resource verification. Electron UI results were 35 passed / 2 failed / 8 installed-only skipped. `github-ci-third.log` preserves the raw failure evidence. The two failures occurred before their behavioral assertions: renderer URL registration exceeded the startup test's 3-second polling budget; three real imports exceeded the queue fixture's default 5-second visibility wait.

The startup test now observes actual `browser-window-created` events before requiring the same compiled production main, and asserts that the main window is created before the LX window. This directly catches the original await-source-before-main defect without equating renderer load speed with creation order. It still exercises the real throw/infinite-loop source, unchanged 5-second source watchdog, local playback/editor, failure status and preserved preferences. The queue fixture allows 15 seconds for its three actual ffprobe imports and cleans Electron/files if setup fails. Queue playback/removal assertions are unchanged.

Only the two affected cases and the throw branch sharing the changed startup assertion were rechecked locally: `npm run test:e2e -- --grep "remembered (throw|hang) source|removing queued B"`, exit 0, 3/3 passed in 17.4 seconds. Both recorded startup window orders were `["音乐工作台", ""]`. Product source, dependencies, the installed runtime and the published installer remain unchanged; no local full suite or build was repeated. [Scoped result](../github/2026-10-13/ci-fixture-scoped-result.json) records this verification. Independent static fixture re-review is Approved with no Critical/Important/Minor; its result is preserved in `ci-fixture-review.md`.

The final remote verification uses the workflow's explicit `fixture_repair_only` manual input to recheck only these three cases. It first fetches baseline `9492eaa` and rejects changes beyond the two fixture files, delivery docs and the workflow. Media/type/build/package checks remain enabled, and the default push/PR/manual behavior remains the full suite. Unit 79/79, integration 67/67 and the other 35 Electron cases reuse the prior actual run. The repair source push uses `[skip ci]` to avoid also starting an unnecessary full run; the separately dispatched scoped run is recorded explicitly, not presented as a full-suite rerun. [GitHub's Boolean inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs) and [event-specific skip semantics](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs) were checked against the official documentation.

## Explicit Electron setup after reducing duplicate tests

Scoped run [38332181453](https://github.com/tallelella1/music-workbench/actions/runs/38332181453), source `a7812df85a8d867d71b155eb54bc9af5b1ce9ac3`, passed the unchanged-product scope guard, media checks, typecheck and compilation, then failed because `node_modules/electron/dist` was missing before packaging. The raw log is in `github-ci-fourth.log`; no UI case ran in this attempt.

Inspection of the installed pinned Electron 44.5.1 `index.js` confirms it downloads the executable synchronously on the first `require('electron')`, calling its own `install.js` only when absent. Earlier unit tests implicitly performed this setup. The workflow now invokes the same official package entry explicitly before testing/building, so fixture-only mode has no hidden dependency on rerunning unit tests. Dependency/runtime versions and published artifacts remain unchanged. The correction adds setup, not tests, and will be verified by the next scoped run.

## Final remote result

Run [38332583220](https://github.com/tallelella1/music-workbench/actions/runs/38332583220), source `9f1dc534e607ae3c5754aa9b3290650b818b26dd`, completed with **success**. It passed the actual unchanged-product scope guard, explicit pinned Electron preparation, media checks, typecheck, compilation, NSIS build, packaged-resource verification, the three scoped Electron cases (3/3, 13.4 seconds), and artifact upload. Both startup observers again recorded `["音乐工作台", ""]`; queue removal played through to C.

[Final API metadata](../github/2026-10-13/ci-final.json) and `github-ci-final.log` retain the result. Unit 79/79, integration 67/67 and the other 35 Electron cases remain the prior actual remote pass, alongside the earlier complete local/installed acceptance. This is intentionally a scoped verification, not a claimed new full-suite pass. Original failures remain preserved; product code, the immutable v0.1.0 tag and the actual installed release artifact are unchanged. No further test or build is required for delivery-record-only completion.
