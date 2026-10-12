# Playlist Workshop and BCN Show Generator (v7-compatible feature patch)

This additive module plugs into the existing Spider Media Center player bridge and AutoDJ playlists. It does not alter the native V6 Nova service, the v7 WebGL visualizers, cloud relay, broadcasting runtime or their rollback procedures.

## Bulk playlist creation

Open Spider Media Center and click **PLAYLIST WORKSHOP** at the upper left. Search the indexed library, select all filtered tracks (or check individual songs), then create a playlist and click **Add selected to playlist**. Hundreds of tracks can be added in one operation. Existing AutoDJ playlists appear in the selector and remain accessible from AutoDJ. Edits include moving or removing songs. The first 400 playlist tracks are shown for performance; entire playlists are saved and exported.

Use **Append to queue** to add the full playlist without interrupting playback. **Replace queue** requires confirmation and refuses to replace the current queue while radio is live. Neither action starts broadcasting or starts AutoDJ. Deleting a playlist never deletes music files.

## Show playlist generation

Enter a show name, length, optional music-theme filter, music source, music tracks between planned Nova cue points, estimated song runtime and repeat policy. Click **Generate show** for a deterministic preview, then **Save to AutoDJ playlists** to save the music as an existing AutoDJ playlist. A separate text rundown contains opening, Nova DJ break, and closing cues. The cues are planning notes: not generated voice files, live interstitials, or scheduled radio automation. For schedule assignment use the existing AutoDJ show scheduler separately.

Imported JSON playlist files require real existing playable URLs; if you move files, index the library again. JSON backups and M3U exports are available. M3U playback requires that referenced local or network sources are accessible on the destination device.

If duration metadata is missing, the show runtime is an estimate. If the source library is too small to fill the time without repeats, a warning appears. The builder never falsely claims that it created a continuous 24/7 cloud broadcast.

## Verification and install guardrails

- New assets are in `dist/playlist-workshop-{core.js,js,css}`. Both React and legacy player HTML load them; the existing React bundle is not replaced.
- `npm test` runs existing playback/Nova/visualizer tests plus show and playlist regressions.
- `npm run check` checks new JavaScript syntax alongside the old media code.
- The existing `npm run package:linux` stages all `dist/` files and verifies the new assets in `app.asar`.
- Do not install new source files over a running Electron process. Build the verified artifact, run `install-v7-preview.sh --check`, then use the existing paired rollback-safe installation flow during the single daily Spider OS update.
- Hardware validation still required on the actual Spider OS machine: playlist editing in React, folder index, 60-minute generated show, Nova /health on 127.0.0.1:9876, now-playing, live radio queue protection, broadcast delivery, 3D visualizer and rollback.

This patch changes neither the installed app nor the station hosting merely by being merged on GitHub.
