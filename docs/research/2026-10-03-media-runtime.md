# Verified FFmpeg runtime preparation

## Current runtime (supersedes the LGPL-labelled preparation below)

- Bundle: `.superpowers/sdd/2026-10-03-music-player-implementation/media-cache/btbn-gpl/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0/`
- Fixed archive: https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-01-13-06/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip
- Verified SHA256: `64f7d1460ce986804386582eeec3bd95117a4e84f7567ad416dd33f434fe8286`, size 86333540 bytes.
- Exact executable version: `n9.0.2-22-g46d8f462ee-20261001`; source commit `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`; BtbN recipe `e88e49f624457c455700b058f0a84ca87d499cc2`.
- LICENSE.txt: GPL v3; configuration explicitly enables gpl/version3. H264 supports libx264 as well as libopenh264. Use actual encoder probe rather than old LGPL assumption.
- Replace original executable/DLL resource hashes and license declaration. Keep the external tool independent from the application process. Source/recipe and copyleft dependency provenance preparation is in packaging-research.md/source-cache.
- Reason for replacement: old LGPL-labelled build statically contains GPL FFTW through chromaprint (recipe and avformat DLL evidence), so LGPL-only labelling would be inaccurate. Do not reuse its metadata as the current runtime.

## Original preparation (historical evidence only)

- Bundle: `.superpowers/sdd/2026-10-03-music-player-implementation/media-cache/btbn/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0/`
- Source: https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip (BtbN is linked by https://ffmpeg.org/download.html).
- Archive size: 76975392 bytes. GitHub release asset digest, independently checked after download: `d892076519d72a343355b32b5206aafab053d4b5377c48a96183315d1b087369`.
- Actual executable version: `n9.0.2-22-g46d8f462ee-20261001` (do not record the filename's 9.0 as the exact executable version).
- License in bundle: LGPL v3. Shared binaries require all adjacent DLLs. Copy `ffmpeg.exe`, `ffprobe.exe`, and the DLLs to resources/bin; ffplay is unnecessary.
- Confirmed filters: afir, equalizer, acompressor, alimiter, ebur128, atempo. MP3 encoding uses libmp3lame. H264 uses libopenh264 (libx264 is disabled in this LGPL build), so visual export must probe actual encoder capability and use supported arguments.
- Version and filter checks executed successfully in the workspace. Task 2 must still record per-binary hashes and prove actual media probes/imports.
- Original Gyan download was slow and stopped. Its incomplete archive and the network range probe are disposable scratch files.
