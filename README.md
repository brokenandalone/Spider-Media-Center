# Spider Media Center

Spider Media Center is the standalone media and broadcast application for Spider OS.

It is being rebuilt from the known-good **Spider Media Player 7.5.0 “Kabel”** baseline into a full Linux-first media center while preserving the playback, DJ, radio, sharing, and visualizer features that already work.

## Current status

**Version:** 6.0.0  
**Platform focus:** Linux / Spider OS  
**Desktop stack:** Electron + React  
**Baseline:** Spider Media Player 7.5.0 “Kabel” / V5.0 compatibility layer, now refreshed in the V6 major upgrade pass

The current repository includes the working Media Center baseline plus the Linux and Spider Radio fixes completed during the 1.0 migration.

### Working now

- Local audio and video playback
- Dual-deck playback engine
- Crossfade and gapless playback
- EQ and stereo controls
- Queue and local media library
- Existing audio-reactive visualizers
- Auto DJ and playlist automation
- AI DJ integration
- Broadcast Studio
- Spider Radio public broadcasting
- Public listener URL through Cloudflare Tunnel
- Broadcast QR code generation and display
- Correct ON AIR / RADIO LIVE state across the Broadcast Studio and top header
- Listener counting
- DJ microphone / live DJ controls
- Show recording
- Party DJ mode
- Nearby Share
- Secure phone remote
- Network streams
- Bluetooth settings integration
- Linux media keys
- Local Linux speech fallback through espeak-ng

## Immersive fullscreen cinema mode (next upgrade)

Select a 3D scene and press the **CINEMA** control to expand the
media stage into native fullscreen without replacing the player,
moving the audio graph or restarting BCN/Nova. The button switches to
**EXIT CINEMA** when active. **Shift+F** is the keyboard shortcut
outside text inputs, and Escape exits using the operating system's
standard fullscreen handling. The control is intentionally unavailable
in 2D mode. Unsupported fullscreen requests display a notice and
leave playback alone. Native Spider OS GPU verification is still
required before installing this next round.

## Immersive performance studio upgrade (development branch)

Spider's local 3D visualizer now has five live color palettes
(Purple, Crimson, Ice, Emerald, Gold), Full/Calm/Still motion, and
Eco/Balanced/Ultra GPU presets. Adaptive resolution uses bounded,
conservative frame-submission timing to scale rendering down when
needed and gradually recover quality. It is not a hardware GPU
benchmark or a guaranteed frame rate. Turn AUTO GPU on/off from the
visualizer stage. The GPU STATS toggle shows resolution, FPS cap,
current adaptive render scale and p75 CPU submission time. RESET
restores default preferences. Settings persist locally and are
validated before use.

Reduced-motion OS preferences start 3D in Still/Eco mode. The
original 2D canvas is hidden only while the 3D scene is visible,
then restored when switching modes or playing video. This avoids
layering two animated visualizers on top of one another. No
extra media engine, new network dependency or cloud data transfer.

This upgrade is not in the existing pinned V6 installer and needs
physical GPU testing before promoting a new installer build.

## V7 development preview: true 3D audio visualizer

The next upgrade round introduces a **real offline WebGL shader visualizer**,
not another flat 2D preset. Four perspective-rendered, ray-marched GPU scenes
respond to the existing Media Center audio FFT:
**3D Tunnel**, **3D Spectrum**, **3D Orbit**, and **3D Broken City**.

The 3D controls live at the upper left of the visualizer stage in both
React and classic players, with a direct style selector and Eco / Balanced /
Ultra GPU quality. **Shift+V** cycles the four 3D modes when focus is not
inside an input. The React fullscreen button remains available; the
classic player gains a fullscreen button. Audio and video playback continue
through the existing Web Audio mixer; there is no added DJ service, new
microphone permission, remote network dependency or media upload.

3D stops rendering behind video and when the app window is hidden. Eco
mode and lightweight mode reduce GPU work. The rendering resolution is
limited to about 720p worth of pixels, even on high-DPI displays. On
WebGL loss or unsupported hardware it switches back to the normal 2D
visualizer instead of stopping playback.

This development preview is **not part of the existing V6 installer**.
That verified release remains pinned on main for installation separately.
No actual PC GPU compatibility claim is made until tested on Spider OS.

## V6 public relay health monitor

V6 adds a functional **BCN public relay reachability watch** to the
existing audio-delivery Signal Monitor. When the operator has already started
a broadcast, the application probes the current public listener state page
every 30 seconds. Three consecutive failed or malformed responses flag a
**degraded public relay** even if the Cloudflare tunnel process did not exit.
A successful check clears the warning. Private URLs and stream tokens are
not included in the diagnostics results.

This watch **does not restart a public broadcast** or change the station URL.
The existing explicit operator recovery action remains for a tunnel-process
exit, and the normal broadcast controls remain available if the internet
path is degraded without process exit.

Public-page reachability, listener socket chunk delivery, and actual audible
playback are three separate states. The first two are observable by Spider OS;
the last must still be checked with a real listening device.

V6 also synchronizes the package metadata and lockfile version to 6.0.0,
preventing the earlier version mismatch in build and installation metadata.

## V6 major feature upgrades

This major pass focuses on the features that make the Media Center release feel production-ready on Linux and Spider OS:

- Improved radio recovery and relay restoration for public broadcasts
- Listener verification, delivery health monitoring, and stale-link detection
- Native movie compatibility conversion to cached WebM for unsupported local files
- AutoDJ continuity guard and show scheduling controls for BCN-style operations
- Nova voice integration, approved listener requests, and local generated audio flow
- Better Linux integration for media keys, cloudflared discovery, and app lifecycle behavior
- Release packaging and installer verification for repeatable upgrades and rollback safety

## Spider Radio

Spider Radio runs a local HTTP broadcast server and can expose it through a temporary Cloudflare Tunnel.

When a broadcast starts, Spider Media Center now:

1. Starts the local radio server.
2. Starts the public Cloudflare relay.
3. Reads the generated `trycloudflare.com` URL.
4. Generates the listener QR code.
5. Updates the internal radio state.
6. Shows **ON AIR / RADIO LIVE** in the Media Center UI.
7. Tracks connected listeners.

### Linux dependency

Spider Radio public relay currently expects `cloudflared` to be available on the system.

On the current Spider OS development machine it is installed at:

```text
/usr/local/bin/cloudflared
```

The application also contains Linux-aware cloudflared path resolution.

## Project layout

```text
Spider-Media-Center/
├── assets/
├── dist/
│   ├── assets/
│   └── index.html
├── electron/
│   ├── main.cjs
│   ├── preload.cjs
│   ├── renderer.js
│   ├── renderer.audio.js
│   ├── renderer.bridge.js
│   ├── player.html
│   └── styles.css
├── package.json
└── README.md
```

### Important files

- `electron/main.cjs`
  Electron main process, IPC, Spider Radio server, Cloudflare relay, Nearby Share, remote services, Linux integration, and application lifecycle.

- `electron/preload.cjs`
  Safe bridge between the renderer and Electron main process.

- `electron/renderer.js`
  Playback engine integration, media state, radio state, DJ controls, recording, queue, sharing, and React bridge support.

- `electron/renderer.audio.js`
  Audio engine support.

- `electron/renderer.bridge.js`
  Stable bridge used by the React UI.

- `dist/`
  Current compiled 7.5-derived React interface used by Spider Media Center.

## Development baseline

The current development tree is intentionally based on the compiled, known-good Kabel 7.5 application rather than rebuilding from the older incomplete React source.

That decision is deliberate. Rebuilding the older source caused newer 7.5 features to disappear, so the working 7.5 application is treated as the compatibility baseline while Media Center features are added incrementally.

### Do not replace the compiled UI with the older source build

The current `dist/` files contain functionality that is newer than the older recovered source tree.

Changes should preserve the working baseline unless a feature has been explicitly migrated and tested.

## Linux migration work

The Media Center backend has been adapted away from several Windows-only assumptions.

Current Linux work includes:

- Linux cloudflared path resolution
- espeak-ng speech synthesis fallback
- KDE / Bluetooth launcher support
- Linux autostart support
- Linux media-key registration
- Electron GPU sandbox repair for the installed build

The installed Electron Chromium sandbox should retain:

```bash
sudo chown root:root /opt/spider-media-center/chrome-sandbox
sudo chmod 4755 /opt/spider-media-center/chrome-sandbox
```

Do **not** permanently disable GPU acceleration. The sandbox issue has been fixed and GPU acceleration is required for the future visualizer work.

## Installation target on Spider OS

The current Spider OS installation uses:

```text
/opt/spider-media-center
```

Launcher:

```text
/usr/local/bin/spider-media-center
```

The packaged Electron application is stored at:

```text
/opt/spider-media-center/resources/app.asar
```

## Development workflow

The active development tree is kept separately from the installed application.

Typical working path:

```text
~/Studio/Media/SpiderMediaCenter/v1.0/media-center-1.0-work
```

Package the application with:

```bash
npx --yes asar@3.2.0 pack \
  "$HOME/Studio/Media/SpiderMediaCenter/v1.0/media-center-1.0-work" \
  "$HOME/Studio/Media/SpiderMediaCenter/v1.0/spider-media-center-1.0.asar"
```

Then install the tested build into the separate Media Center installation. Back up the current ASAR before replacing it.

For the repeatable playback upgrade, use `npm ci`, `npm run check`, `npm test`,
then `npm run package:linux`. The verified archive, checksum manifest and selective
installer appear in `release/`; see [build installation](docs/INSTALL-BUILD.md).
CI also publishes this folder as a workflow artifact. The package retains the
compiled interface and includes production dependencies, excluding recovered
backup scripts, the Windows relay binary and build tools.

## Preservation rules

- Do not modify the known-good Spider Media Player installation.
- Do not delete the frozen 7.5 donor.
- Do not replace the current Media Center UI with the older incomplete React source.
- Make changes in small tested steps.
- Keep a rollback copy before installing a new ASAR.
- Preserve playback, DJ, radio, visualizers, sharing, and queue behavior while adding new Media Center features.

## V6 Nova request reliability and paired install rollback

The native **Nova** DJ remains a single Spider OS service. Media Center now
serializes overlapping break-generation calls so two end-of-song events do
not select the same approved listener request or repeat a show introduction.
Its queue is bounded, and a failed AI response does not mark a dedication
as prepared. Approved and pending requests survive rotation of completed
Request Desk history; unsolicited request types cannot override approval.

The combined V6 installer saves a paired backup of the existing Media Center
archive and the native Nova Python service. A failed Nova installation,
service restart, or Nova health check restores both components rather than
leaving mismatched versions installed. Build receipts now live under a
version-specific Studio/Media/SpiderMediaCenter folder. This installer does
not update Spider OS itself.

## BCN controlled relay recovery

If the public Cloudflare Quick Tunnel **exits unexpectedly** after a confirmed
live session, Media Center now records a bounded, session-only recovery
candidate. The BCN Media > Signal Monitor > Operator Relay Recovery section
shows the outage and permits restoration **only after a fresh operator rights
confirmation**. The app never automatically restarts a public broadcast.
Manual Stop revokes the recovery option.

Recovery is serialized with Start and Stop to avoid duplicate public tunnel
instances. Attempts have a 15-second cooldown and a rolling maximum of three
per hour. Recovery rotates the one-time URL and QR code; previous links must
be replaced. The queued tracks and DJ programming are not rebuilt, and any
listener submission window closes during the outage. Diagnostics do not expose
secret radio tokens or previous public links.

This is not an auto-reconnect service or verified 24/7 unattended mode. It
covers an unexpected tunnel process exit; other network faults may require
manual troubleshooting and a fresh start.

## BCN signal monitoring

The BCN Media panel now includes an operator-only **BCN Signal Monitor**. It
distinguishes the public relay being ready, zero connected listeners, waiting
for the first audio chunk, active socket writes and stale listener streams.
Metrics are derived from actual audio data writes, rather than a generic ON
AIR flag. The main process counts delivered chunks, limits slow listener
backpressure, and restricts broadcast IPC calls to the trusted app window.

When a listener stream stalls, the optional session-only continuity guard
disarms rather than claiming that changing songs would repair an encoder or
internet relay problem. A connected stream and successful server writes
**do not prove the remote listener can hear audio**. Real phone/headphone
tests are still required before unattended broadcasting is supported.

## BCN network and native Nova DJ

BCN broadcasting and international media discovery are part of Spider Media Center:

- Broken City Network (BCN) public-facing station branding
- International talk/news/speech radio discovery using Radio Browser
- Public IPTV playlist loading, including the iptv-org catalog
- Spider-native network playback architecture using embedded/reused VLC/libVLC technology where license-compatible
- BCN media/relay panel layered on top of the compiled 7.5 UI
- Native Spider OS AI DJ service (normally `http://127.0.0.1:9876`) with **Nova** as Webbie's on-air DJ name
- Planned live-radio hosting with show-clock scheduling, back-announces, front-sells, liners, requests and reliable mix timing

The proposed USB-portable DJ was never deployed and was removed to avoid maintaining a second runtime. Nova uses the native Spider OS service.

The existing compiled **Nova DJ Control** panel remains the user-facing control (enable, DJ break frequency, lead time, voice volume and ducking). Its loopback requests are bridged through secure Electron IPC to the native `127.0.0.1:9876/dj/prepare` service. Only generated files inside the native DJ cache can be loaded; Media Center returns them as bounded in-memory audio. Nova's spoken breaks use the same Web Audio context and `broadcastDestination` as the music decks, reaching both local speakers and BCN's listener stream. Missing services and late/skipped announcements do not stop music.

### BCN Show Clock and Request Desk

The BCN Media panel now includes a **local-time weekly show schedule** and an **operator-only request desk**. Schedules are saved privately in Electron's user-data directory and pass the active show name and voice tone into Nova's next prepared announcement. On the first eligible DJ break in a show, Nova prepares a show introduction; the first break after the block ends can close that show. Overnight programs must be entered as separate blocks on each side of midnight.

**Public listener submissions (opt-in):** While BCN Radio is already live, the operator can enable listener submissions from BCN Media > Request Desk. The existing public station page then shows a mobile-friendly request form. Requests enter the existing desk as **pending**, with bounded text, JSON-only input, cross-site request rejection, a per-client ten-minute limit, and a global request cap. No public request can start radio, add music to the live queue, or bypass approval. Intake closes on radio stop or application restart, and no listener network addresses are stored on disk.

**BCN Continuity Guard (opt-in per session):** After an operator starts BCN and AutoDJ, confirms their rights for the queued songs, and has two or more playable queued tracks, they may arm the existing playback recovery guard. It waits 15 seconds before attempting paused-track recovery, limits consecutive attempts, and automatically disarms when the broadcast stops, AutoDJ stops, or the queue runs short. It does not start or restart public broadcasts, choose new songs, reconnect a failed Cloudflare tunnel, or provide a verified 24/7 station. It must be tested on the installed PC before unattended use.

Requests begin **pending**. An operator must approve them before their wording is passed to Nova. Approvals can be withdrawn before audio is generated. A request marked **prepared** has been used in generated voice audio; it does not prove that audio aired. Public listener-submission endpoints and automated moderation have not been enabled.

The show clock **does not start a broadcast**, change the rights-confirmation workflow, or play unauthorized music. The broadcaster must start and stop BCN deliberately.

Automation and streaming still require an end-to-end installed Spider OS broadcast test before unattended operation is considered verified.

Spider Media Center will not launch VLC as an external fallback player; VideoLAN technology is treated as an upstream source/embedded engine option inside Spider's own playback stack.

External radio retransmission should only be enabled when the operator has permission to rebroadcast the selected source. Generic web services can be opened normally, but Spider does not include protected-stream extraction or DRM/paywall/ad-circumvention code.

## Planned Media Center expansion

The next major phase expands Spider Media Center beyond the original player:

- Music
- Movies
- TV Shows
- Live TV / IPTV
- Photos
- Network Media
- Devices and Casting
- DLNA / UPnP support
- Improved streaming support
- Full-screen media-center navigation
- True GPU / WebGL audio-reactive video visualizers
- Additional Webbie integration
- Better MPRIS / Linux desktop media integration

Existing Canvas visualizers will be preserved when GPU visualizers are added.

## Relationship to Spider Native OS

Spider Media Center is maintained as its **own repository**.

- **Spider Native OS** contains the operating system, desktop environment, Webbie, Studio, Study, Kali Bay, and system integration.
- **Spider Media Center** contains the standalone media, DJ, broadcast, radio, sharing, and entertainment application.

Keeping them separate allows Media Center to be developed, tested, packaged, and released without destabilizing the operating system.

## Repository

`brokenandalone/Spider-Media-Center`

## License

No license has been selected yet. Until a license is added, normal copyright restrictions apply.

## Playback reliability and local movie compatibility

The Play and queue-play bridge methods now wait for playback before returning a
snapshot. Failed decoding appears in the Media Center screen. Media Session Play
and Pause are idempotent; optional mixer failures no longer block the video deck.
The embedded visualizer keeps running through unavailable canvas mounts, and stale
broadcast links no longer make a stopped station appear live.

For a local movie that Chromium cannot decode, choose **Prepare and play here**
in the playback error card. The installed `ffmpeg` decoder prepares a separate
VP8/Opus WebM copy, then plays it in the existing embedded deck. This is a
compatibility conversion, not the planned full libVLC engine. It opens no external
player and does not modify the source. Preparation has elapsed-video progress,
cancellation, a two-hour time limit, a 4 GiB cache limit, and low-disk checks.
Cached copies are reused when the source size and modification time match.
On Linux they live under `$XDG_CACHE_HOME/Spider Media Center/movie-compatibility`
(or `~/.cache` when unset); stop playback before manually removing cached copies.
Other platforms use Electron's temporary directory.

Preparation can take several minutes, limits video width to 1920 pixels, uses the
first video and audio streams, and does not preserve subtitle tracks. It covers
local movie files; it does not decode streaming-service pages or add HLS support.
Full direct libVLC decoding, subtitle controls, and native stream support remain
future work. The existing browser playback path is retained. Direct playback during a mixer
failure bypasses EQ and broadcast processing until the mixer recovers.

Run `npm run check` and `npm test`. The decoder integration test generates a small
MPEG-4/PCM Matroska movie, verifies the resulting VP8/Opus streams with ffprobe,
checks that the original is unchanged, and checks cache reuse. CI installs FFmpeg
to run this fixture. Tests also cover cancelled preparation, invalid inputs,
async Play, optional mixer recovery, detached decks, radio state, and canvas
rescheduling. A packaged Electron GUI and owner-PC playback check are still
required; source tests are not evidence that the installed binary was updated.
