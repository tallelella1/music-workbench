# Visual Task 2 integration context

Requirements are the visual plan's task-2-brief.md; consume the final reviewed audio/visual Task 1 interfaces.

- Bind preview motion to the currently playing asset/revision represented by AudioBinding, not merely to whichever global player time is advancing. Inspect the final PlayerEngine/PlayerController identity contract and expose only any necessary missing identity. A different selected song or stale binding cannot keep driving the saved scene with the previous BeatMap.
- The actual processed file has its own sourceSeconds and hash-bound, remapped BeatMap. AudioBinding.timeMap is provenance and A/B conversion, not a second multiplier for bounce phase. Pause/seek/rate follow the actual audio clock.
- A manual BPM correction can be persisted in AudioBinding.beatMap with source='manual' through the reviewed rhythm correction contract. Preserve BPM/offset/beatRate in the saved state used by later export; an ephemeral UI value alone cannot reproduce the scene. Keep no-audio/no-energy behavior faithful to the brief rather than introducing an independent timer.
- Preview and later exports share bounceTransform/compositor and the same smoothed source-domain energy envelope. Distinguish automatic detection error from rendering alignment. Use actual Canvas/Electron evidence for pause/seek/rate and fixed text/background pixels; visual inspection can be recorded as agent inspection, without inventing a user's manual evaluation.
