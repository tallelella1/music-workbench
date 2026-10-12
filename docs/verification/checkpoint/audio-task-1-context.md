# Creative Task 1 integration context

Requirements are task-1-brief.md. This is a dependency handoff, not a new feature list.

- StorageRepository lives in src/main/storage/repository.ts, with atomicWrite and per-module queues. Its current path allowlist is library/settings/extensions only. Extend only the named project index/revision storage needed by this task; no renderer-provided arbitrary paths or modules. Keep strict version validation, preserve corrupt/newer original bytes, and do not overwrite an index with a stale read after another queued operation.
- Base Task 7 coordinates preferences and the asset index that historically lived in settings.json. Consume its final repository/asset API; never replace settings with a creative-only schema.
- Project source and derived assets are host-owned AssetRecord IDs. Base Task 6 provides checked immutable input snapshots for hash-bound work; a record's saved hash by itself does not prove that an original external file still has those bytes. Validate current source identity using the final asset facility before accepting a hash-bound revision.
- Independent immutable revision files precede the index pointer that selects them. An interrupted index update must not erase previous revisions/derived resources; orphan data can remain recoverable. All project operations need consistent serialization so competing append/restore operations cannot both silently win.
- Visual project state remains unavailable until a concrete runtime scene schema is registered by the visual unit. Do not accept unknown scene data merely because the TypeScript union includes it.
- Existing TaskService.start/get/cancel emits jobs.updated with normalized JobSnapshot. Old task results may remain accessible but cannot append over a new current revision. Exact IPC methods and result/event runtime validation remain mandatory; preload stays one self-contained sandbox bundle.
- User has no LX/Gemini service configuration and authorized software/local completion. History/undo/restore must work locally without any provider call. Real external model coverage stays unconfigured.
