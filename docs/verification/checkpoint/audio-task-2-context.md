# Creative Task 2 integration context

Requirements are the audio plan's task-2-brief.md. This is a dependency handoff; do not enlarge the feature scope.

- The final reviewed AssetRegistry supplies checkedSnapshot(assetId, expectedHash, ctx). Analyze the checked bytes, not an external path reopened after verifyOriginal. A cache hit still requires current source identity confirmation; a saved AssetRecord hash alone cannot prove the external original is unchanged.
- Base runtimeBinary/executeMediaRuntime use the selected bundled FFmpeg/ffprobe with argument arrays, windowsHide, abort and actual child-close drain. New streaming analysis must retain that cancellation/shutdown behavior. Normalize failures before named IPC; path-bearing FFmpeg diagnostics remain main-only.
- TimeMap describes one crop/rate conversion from the chosen input asset to its derived output. Base derived AssetRecord.sourceTimeMap additionally retains source asset provenance. Do not apply provenance a second time to playback or beat phases already measured relative to the actual derived file.
- Silence, too-short ranges, unreliable tempo and non-finite measurements remain null/unavailable as the brief requires. Distinguish measured values, detection confidence and user corrections. EnergyEnvelope/beatSeconds use source coordinates relative to the asset whose hash is recorded.
- Analysis streaming cannot retain an entire long decoded PCM file in memory. Cache identity includes source hash, selected range, configVersion and analyzerVersion. Cancellation must prevent a partial result from becoming a reusable completed cache entry.
- This task has no remote provider dependency. Actual media-generated signal/tempo/time-map checks are its acceptance; service capability validation arrives in Task 3 and user listening remains explicitly pending.
