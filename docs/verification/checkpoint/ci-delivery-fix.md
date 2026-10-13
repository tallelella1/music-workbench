# CI delivery environment corrections

The first remote Windows run for source `33f66a1` failed 2 of 67 integration tests:

- Effect-chain integration could not access `out/main/index.js`: integration ran before the existing build step.
- File symlink replacement compared the canonical `runneradmin` destination with the `RUNNER~1` temporary-path alias at line 120.

The existing integration step now follows the Windows installer build and packaged-resource check. No extra build was added. The audio-export lifecycle fixture canonicalizes its newly created temporary directory with `realpath`; assertions, timeouts, and symlink protection remain unchanged.

Validation: inspected the targeted diff; `git diff --check` passed. Local suites and builds are deliberately not repeated: runtime behavior and the earlier local full/installed tests already passed. The next existing remote Windows workflow must verify these two CI-specific failures. Remote verification is pending; this checkpoint does not claim a passing remote run.
