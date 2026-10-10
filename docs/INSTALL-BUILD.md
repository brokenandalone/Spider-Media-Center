# Media Center playback build

## Combined BCN/Nova installation

For the installed Spider OS machine, use the root-level source script
`scripts/install-nova-bcn.sh` from the Media Center repository rather than
installing two independent DJs. The script installs the verified Media Center
archive and upgrades the **existing** Spider OS `spider-ai-dj.service` with
the native Nova persona. It validates the source, backs up the existing archive
and Python service, and runs a native DJ health check. It does not touch Webbie
or the separate, known-good Spider Media Player.

The native Nova service recognizes station IDs, liners and show introductions.
The BCN Show Clock and Request Desk live in the Media Center upgrade itself. The
scheduler only chooses *spoken context* during eligible DJ transitions; it
does not start/stop broadcasts or automate DJ-on-air status. Weekly show
blocks use the computer's local time. Pending requests require approval, and
the prepared status must not be mistaken for confirmed airtime. Settings and
request review state are saved under the existing Electron user-data folder.

Media Center automatically requests a BCN station ID every fourth successfully
prepared DJ transition. Show context and any explicitly approved requests are
sent through the existing secure Electron bridge. This does not yet establish
a completed live listener-request UI or a 24/7 broadcast scheduler.


This is an application archive upgrade for the existing **Spider Media Center**
installation at `/opt/spider-media-center`. It preserves the compiled Kabel 7.5
interface, the existing Electron runtime, application settings, libraries and
the separate Spider Media Player installation.

Extract the build, open a terminal in its folder and run:

```bash
bash install-media-center.sh --check
```

Close Spider Media Center completely, then install:

```bash
sudo bash install-media-center.sh
```

The installer checks the supplied hashes, refuses a running application, keeps
a timestamped archive backup and replaces only `resources/app.asar`. FFmpeg is
installed if missing for local movie compatibility preparation. The existing
launcher and Chromium sandbox configuration remain in place. No reboot is needed.

Open Media Center from The Web's Media workspace and check:

- Play, Pause and seek with a local song and movie.
- For an unsupported local movie, use **Prepare and play here**. Check progress,
  cancellation and replay; confirm the original file is unchanged.
- Check the visualizer, microphone/mix, and broadcast stop/start state.

An incompatible movie is converted to a separate cached VP8/Opus WebM copy.
This is not direct libVLC decoding, subtitle preservation or a fix for protected
streaming-service pages. Full native decoding, live TV and casting remain planned.

Source tests and archive checks pass before packaging; actual Electron playback
and installed-machine checks remain required. This is a release candidate.
To roll back, close Media Center and use the exact `sudo cp -a` command printed by
the installer. Do not alter `chrome-sandbox` permissions or delete the backup.

Developers: Node 22.12 or newer; run `npm ci`, `npm run check`, `npm test`, then
`npm run package:linux -- /absolute/output/folder`. Packaging uses a locked
dependency tree, the current compiled UI and only active runtime files.
