# Unified V7 + V6 Nova installation

A single release artifact now includes `install-v7-with-v6-nova.sh`.
This installs **V7 Media Center** and refreshes the **existing V6 Nova
service** from pinned Spider OS commit `980fccf98e4dfdfdb27b32a49c46158ca752a79c`.
The V6 playback, BCN, scheduling and request features remain in V7.
This does not install a separate DJ daemon, nor alter Spider OS itself.

Extract the GitHub Actions **Spider-Media-Center-Playback-Build**
artifact, close Media Center, then run as your **normal desktop user**:

```bash
bash install-v7-preview.sh --check
bash install-v7-with-v6-nova.sh --install
```

The combined installer requests sudo when required, verifies the V7
archive and native Nova source, creates paired backups, installs the V7
archive, updates the existing Nova files, restarts the single Nova
user service, and checks the local Nova health response. On postinstall
failure, it attempts to restore both components.

**Important:** this is a V7 preview whose physical GPU, playback,
and public BCN audio tests remain outstanding. The original V6
`install-nova-bcn.sh` is still pinned and unchanged.

# V7 isolated preview build (not yet hardware validated)

This release bundle now contains **install-v7-preview.sh**, an opt-in
preview installer distinct from the V6 Nova/BCN installer. It changes
only the existing Media Center `/opt/spider-media-center/resources/app.asar`,
not Spider OS, Nova's native service, Webbie or your media libraries.

After downloading the GitHub Actions release artifact and extracting
it, first verify integrity **without sudo**:

```bash
bash install-v7-preview.sh --check
```

This checks every SHA256SUMS entry and verifies that build.json explicitly
marks an unverified V7 preview with the exact archive SHA and source
revision. A successful check is **not** proof of GPU or radio operation.

Close Spider Media Center and deliberately opt in:

```bash
sudo bash install-v7-preview.sh --install
```

The installer refuses to run over a symlink or active Media Center
process, verifies the original backup, and atomically swaps in the
new archive. It prints the full backup path and a precise rollback
command. To roll back, close the player and run the printed command:

```bash
sudo bash install-v7-preview.sh --rollback /opt/spider-media-center/resources/v7-preview-backups/app.asar.before-v7-REPLACE-WITH-PRINTED-NAME
```

Do **not** type the placeholder filename literally. Use the exact backup
path the installer printed. The backup is stored under the dedicated
V7 preview backup directory. The original V6 combined installer remains
pinned to the previous verified release, and no V7 upgrade is
automatically installed on the user's machine.

On the actual Spider OS GPU, test all four 3D scenes, the eight
cinematic presets, Eco/Balanced/Ultra, fullscreen entry/exit,
custom scene persistence, music-to-video transitions, Nova voice
breaks and BCN listener audio before considering V7 stable.

## V7 Cinema lifecycle acceptance (pending physical GPU test)

The visualizer must register the fullscreen listener and stylesheet once,
not once per animation frame. Automated regression checks exercise 300
frames and ensure a single GPU canvas, control panel, scheduled frame,
and fullscreen listener. A movie starting during cinema fullscreen must
exit fullscreen and restore video without stopping audio or Nova.

On the actual Spider OS computer, enter and exit Cinema Mode repeatedly
for at least five minutes, switch from music to a movie, then return to
music. Check GPU utilization, application memory growth and keyboard
shortcuts. GitHub's mocked WebGL tests cannot prove hardware performance.
The pinned V6 installer remains the last separately verified install path.

# Media Center playback build

## Verify supervised BCN relay restoration

After confirming the station is live and playing rights-cleared material,
simulate a controlled relay failure on a test broadcast. When the existing
public Cloudflare relay process exits unexpectedly, the station goes off air,
and BCN Media > Signal Monitor displays **Operator Relay Recovery**. Check
the permission confirmation box and select **Restore BCN relay**. A new
temporary public URL is issued; distribute the new link or QR code and verify
phone audio. Normal **Stop broadcast** must not offer recovery. There is no
automatic restart, no reuse of an expired listener link, and no second DJ
daemon.

## V6 Nova preparation and combined rollback verification

The V6 Request Desk preserves pending and approved submissions when its
history is full. Native Nova requests run through a bounded serial
preparation queue; failed voice generation does not consume an approved
dedication. Live speech and the actual radio relay still require end-to-end
device checks.

The consolidated Media Center/Nova installer checks its tested source SHA
and build hash before changes. It now snapshots the original Media Center
archive independently, snapshots the existing Nova service and persona, and
restores both after failed native source installation, service restart or
health confirmation. Previous installer backups remain available. The script
does not perform Spider OS installation, kernel changes or OS upgrades.

## V7 3D visualizer device acceptance (preview branch only)

This branch packages its own offline vertex and fragment shaders, plus a
WebGL1 renderer and controlled GPU quality. Verify the following **on the
actual Spider OS GPU** before releasing it:
- With audio playing, select 3D Tunnel, Spectrum, Orbit, and Broken City.
  Confirm each scene responds to bass and mid/high frequencies.
- Switch among Eco, Balanced, and Ultra quality, then resize the window.
  Confirm there is no crash and playback does not lose audio.
- Enter/exit fullscreen, test Shift+V and reopen the app to verify that
  the selected 3D scene and quality preference survive.
- Play a movie and verify the visualizer hides behind the video.
- Disable hardware acceleration or use a WebGL-incompatible system and
  verify that the normal 2D visualizer remains usable.
- Check BCN radio and native Nova with a separate listening device. The
  visualizer must not change the broadcast's audio stream.

V6's existing one-command installer still points to the previously
verified V6 code. A V7 installable release needs its own build, testing
and explicit promotion instead of silently overwriting the existing V6.

## V6 reachability and version validation

V6 checks the current temporary public BCN listener page roughly every 30
seconds while the operator's broadcast is active. In **BCN Media > BCN Signal
Monitor**, the public relay check reports a reachable station page or warns
after three consecutive failed checks. A successful page fetch is *not* an
audio-listening test. Verify sound with a separate phone and headphones.

The build metadata and npm lockfile now identify the same V6 release. The
existing combined installer continues to install the Media Center archive
and the single native Nova DJ service; no additional DJ daemon is created.

## Verify actual BCN stream delivery

After starting a **permitted** BCN broadcast, open **BCN Media > BCN Signal
Monitor**. With zero listeners, expect "No listeners": the server cannot claim
to have delivered audible sound. Connect a phone using the broadcast link,
tap Listen, and watch the status move from awaiting the first audio chunk to
sending. If socket delivery stalls, the panel will warn, and any armed
Continuity Guard will disarm rather than attempting to restart public
broadcasting. The operator still needs to listen to the audio on the phone:
server bytes alone are not proof of audibility.

## Combined BCN/Nova installation

For the installed Spider OS machine, use the root-level source script
`scripts/install-nova-bcn.sh` from the Media Center repository rather than
installing two independent DJs. The script installs the verified Media Center
archive and upgrades the **existing** Spider OS `spider-ai-dj.service` with
the native Nova persona. It validates the source, backs up the existing archive
and Python service, and runs a native DJ health check. It does not touch Webbie
or the separate, known-good Spider Media Player.

The native Nova service recognizes station IDs, liners and show introductions.
Real BCN listener submissions and the optional session-only continuity guard now live in this Media Center upgrade too. Listener submissions start **closed** and are exposed only while the operator has an active public broadcast and explicitly opens requests; they arrive as pending and never bypass approval. The guard requires existing BCN/AutoDJ operation and a rights confirmation, limits recovery attempts and disarms if radio stops. Neither feature starts public broadcasting on its own, and remote/mobile and actual audio mixing still require physical-device validation.

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
