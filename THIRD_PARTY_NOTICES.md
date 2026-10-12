# Third-party notices

The application source has no public redistribution license grant (`UNLICENSED`). This does not change the independent licenses of third-party components below. Application-created exports remain the user's files.

## External media runtime

FFmpeg/ffprobe and seven adjacent shared DLLs are the **GPL-3.0-or-later** BtbN GPL-shared build `n9.0.2-22-g46d8f462ee-20261001`. The executables run as external processes. They are outside ASAR under `resources/resources/bin/`; do not separate them from their DLLs.

Fixed archive: https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-01-13-06/ffmpeg-n9.0.2-22-g46d8f462ee-win64-gpl-shared-9.0.zip

Archive SHA256: `64f7d1460ce986804386582eeec3bd95117a4e84f7567ad416dd33f434fe8286`.
FFmpeg source: `46d8f462eeb87ee1f704d8c44a0ee24fca471ad1`; BtbN recipe: `e88e49f624457c455700b058f0a84ca87d499cc2`.
Full runtime GPL text ships as `resources/notices/FFmpeg-LICENSE.txt`. Binary bytes/hash manifest is `resources/media-runtime.json`.

The installer-adjacent `sources/` contains the fixed FFmpeg source, recipe and patches, original build configuration/locks, official download-cache ZIP, supplementary Rust crates and hash verification. Read `sources/NOTICES.md`, `license-index.json`, `COPYING.GPLv3`, `GCC-COPYING.RUNTIME`, `GCC-RUNTIME-BOUNDARY.md`, `BUILDING.md`, `DELIVERY-STATUS.md` and `SOURCES.sha256`. Component copyright/license source paths are indexed in those materials. The original recipe's `cargo update cc` post-update build-helper lock was not preserved; actual linked source closure and bit-identical rebuild are not claimed. Do not replace these exact materials with a mutable latest URL.

## Application dependencies

Electron 44.5.1 is MIT with Chromium and other third-party notices shipped as `LICENSE.electron.txt` and `LICENSES.chromium.html`. React/React DOM 19.3.0, Zod 4.6.5 and music-metadata 12.0.0 are MIT. Their packaged dependency license files remain in ASAR, with generated bundled notices in `resources/notices/APP-DEPENDENCIES.txt`. Development-only build/test tools are not shipped; installed ASAR/resource verification is recorded in the acceptance report.
