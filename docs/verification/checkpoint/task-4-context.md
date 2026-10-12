# Task 4 integration context

Requirements are task-4-brief.md. This context records earlier interfaces, not additional feature scope.

- Search research is .superpowers/sdd/provider-research.md. It contains fixed official LX source references and bounded successful live wy/kg/tx searches. Endpoint body/signature/schema changed from common old examples; read that report before implementing. It does not replace your own live probe or fixture acceptance.
- Main-only network and exact named IPC boundary remain required. Renderer sees normalized Track/SearchResult, not raw provider JSON, headers or auth tokens. Keep existing trusted sender checks and production CSP/per-response dev style nonce intact.
- Track accepts namespaced source IDs. version is TrackVersion; versionDisplay is raw string | null. src/shared/track-version.ts inferTrackVersion and provenTrackVersion were independently reviewed. No marker means unknown, never studio. Preserve raw original title/suffix evidence; normalization is an identity copy. Artists/duration missing are not fabricated.
- Matches lacking complete identity evidence remain separate; task 5 later owns strict source matching and complete playback. Search results must report full playback as not yet resolved. Search success is not proof of playable complete audio.
- Existing single bundled sandbox preload must remain self-contained; do not create shared CommonJS chunks requiring sibling files.
- Separate actual responses captured by your dated probe from synthetic error/timeout/limit fixtures. Current research successful probes were public search only, no account credentials or playable links. Treat text/plain JSON from kg/tx by actual parsing rather than rejecting solely for MIME.
- Runtime original asset identity/Range changes belong to reviewed Task 3. Consume its public playback interface, do not change PlayerEngine for new provider registration.
- Read-only lx-compat-research.md will feed Task 5. No user real source script or account has been supplied, so real full-source playback remains unverified until actual configuration exists.
