# Playlist Workshop and BCN Show Generator (v7-compatible feature patch)

This additive module plugs into the existing Spider Media Center player bridge and AutoDJ playlists. It does not alter the native V6 Nova service, the v7 WebGL visualizers, cloud relay, broadcasting runtime or their rollback procedures.

## Bulk playlist creation

Open Spider Media Center and click **PLAYLIST WORKSHOP** at the upper left. Search the indexed library, select all filtered tracks (or check individual songs), then create a playlist and click **Add selected to playlist**. Hundreds of tracks can be added in one operation. Existing AutoDJ playlists appear in the selector and remain accessible from AutoDJ. Edits include moving or removing songs. The first 400 playlist tracks are shown for performance; entire playlists are saved and exported.

Use **Append to queue** to add the full playlist without interrupting playback. **Replace queue** requires confirmation and refuses to replace the current queue while radio is live. Neither action starts broadcasting or starts AutoDJ. Deleting a playlist never deletes music files.

## BCN Radio approved artist lineup

BCN keeps four permanent named artist credits: **Broken Sorrow**, **Therapy and Sonz**, **Justin Therapy**, and **J-Cold**. A separate **temporary Unknown Artist allowance** is enabled by default for the owner's not-yet-tagged library: it accepts either the literal `Unknown Artist` credit (case-insensitive) or an empty/missing artist field. This is essential because the native media importer actually records untagged artist metadata as the empty string even when the UI renders an `Unknown Artist` label. The allowance does not automatically accept unrelated **named** artists. J-Cold matching still tolerates dash/spacing differences.

In BCN MEDIA > Nova and PLAYLIST WORKSHOP > BCN Show Generator, the **Temporarily allow Unknown Artist / untagged songs** checkbox controls the shared allowance. When the music has been properly tagged, **turn it off** to return to strict four-artist filtering; the switch does not rewrite any metadata. A switch change affects the next cue selection or newly generated show, but already saved show playlists should be reviewed or regenerated.

**Important:** Unknown Artist is not an identity or a licensing check. While the switch is on, *any* otherwise eligible untagged song can enter a BCN cue or new show. Review the queue and confirm music distribution/broadcast rights before going live. The personal Media Center library remains unrestricted.

This rule applies to **new BCN show playlists created by the Workshop**. The general Media Center's personal playback, manual playlists, previously saved AutoDJ playlists, and live stream transport are not retroactively filtered. Inspect existing AutoDJ playlists before using them for BCN. Mislabeled media should be retagged rather than assumed to be approved based on filename or genre.

## Show playlist generation

Enter a show name, length, optional music-theme filter, music source, music tracks between planned Nova cue points, estimated song runtime and repeat policy. Click **Generate show** for a deterministic preview, then **Save to AutoDJ playlists** to save the music as an existing AutoDJ playlist. A separate text rundown contains opening, Nova DJ break, and closing cues. The cues are planning notes: not generated voice files, live interstitials, or scheduled radio automation. For schedule assignment use the existing AutoDJ show scheduler separately.

Imported JSON playlist files require real existing playable URLs; if you move files, index the library again. JSON backups and M3U exports are available. M3U playback requires that referenced local or network sources are accessible on the destination device.

If duration metadata is missing, the show runtime is an estimate. If the source library is too small to fill the time without repeats, a warning appears. The builder never falsely claims that it created a continuous 24/7 cloud broadcast.

## Library cleanup

Click **PLAYLIST WORKSHOP > Music Library Cleanup > Scan invalid entries** to review stale local file references, such as deleted media, empty files, broken `file://` links or unsupported formats. The report separates valid, invalid, network/stream and inaccessible entries. Temporarily disconnected removable drives should be reconnected before cleanup because missing paths will be reported as missing. The operator must confirm **Clear invalid stored entries**. AutoDJ and BCN broadcasting must be stopped before any cleanup. The app first writes a private JSON recovery snapshot under the Electron user-data directory in `library-cleanup-backups`. If backup fails, it will not clear any stored references. Actual audio files are never deleted.

By default, cleanup also removes invalid song references inside existing saved AutoDJ playlists and marks affected show rundowns for regeneration. Turn off the checkbox to keep existing playlists unchanged. Active playback should be paused. The scan is repeated just before removal; if the library has changed, the operation stops and asks for a fresh scan.

## Nova's shared Australian voice profiles

BCN MEDIA > Nova > **Voice profile** now supports automatic Natasha/Matilda fallback, Natasha online, and Webbie's existing Australian neural Piper speakers: Matilda, Kirra, Bindi, Marlo, Tully, and Willow. It uses the **same Webbie user-owned model files** at `~/.local/share/spider-os/webbie-neural-preview`. No model files are downloaded in the installer or included in the Media Center archive. The preferred voice is stored as a small local setting and is sent securely to Nova with the next DJ-break request; it does not play on desktop speakers separately. Nova returns audio to the existing DJ mixer. If the chosen Piper voice is not available, Nova falls back to Matilda if available, then Natasha online, then eSpeak. The **Check Australian voices** control reports installed voice availability from native Nova.

The paired installer updates `service.py`, `nova_host.py`, and `nova_voice.py` from the pinned, tested Spider OS revision and backs up prior files before restart. Voice availability and live mixer playback must still be checked on-device.

## Nova plays from the cue when there is no selected playlist

Click **Start AutoDJ** after putting approved songs in the player queue. If no show playlist has been explicitly started, the button starts a **session-only BCN Live Cue** rotation from the existing queue without creating/saving a playlist. Its available tracks update when the queue changes. Only the four permanent named artists or temporarily allowed Unknown Artist/blank-tag entries are eligible. Other named artists are not chosen. The temporary allowance can admit music you did not intend to broadcast, so check the queue carefully. Stop AutoDJ to end cue rotation. Existing directly selected playlists and programmed show scheduling remain independent. This feature never starts the public broadcaster, adds downloaded tracks, or grants stream rights.

## Verification and install guardrails

- New assets are in `dist/playlist-workshop-{core.js,js,css}`. Both React and legacy player HTML load them; the existing React bundle is not replaced.
- `npm test` runs existing playback/Nova/visualizer tests plus show and playlist regressions.
- `npm run check` checks new JavaScript syntax alongside the old media code.
- The existing `npm run package:linux` stages all `dist/` files and verifies the new assets in `app.asar`.
- Do not install new source files over a running Electron process. Build the verified artifact, run `install-v7-preview.sh --check`, then use the existing paired rollback-safe installation flow during the single daily Spider OS update.
- Hardware validation still required on the actual Spider OS machine: playlist editing in React, folder index, 60-minute generated show, Nova /health on 127.0.0.1:9876, now-playing, live radio queue protection, broadcast delivery, 3D visualizer and rollback.

This patch changes neither the installed app nor the station hosting merely by being merged on GitHub.
