# BCN programming and DJ end-to-end source audit
Audit date: 2026-10-12. Reviewed repository source and automated tests, **not** the operator's running PC. This audit is the baseline for consolidating Spider Media Center and Nova. The public BCN Network website remains a separate product.

## Verified causes

### One station, three separate scheduling stores

1. **Playlist Workshop** generates a show and saves its real AutoDJ playlist under the compiled React manager's `spider.autodj.playlists` localStorage. The rundown stays in `spider.playlist.workshop.shows.v1`. Previously it never contacted BCN scheduling. **Fixed this iteration:** "Save show to BCN Scheduler" now calls the trusted Electron `bcn:program-register` channel and registers an unscheduled show in persistent `bcn-desk.json`, with its playlist ID, name, track count and estimated duration. BCN Media shows it immediately and lets the operator schedule a weekday block. Audio/rundown files are not copied into the desk.
2. **BCN Show Clock** was a separate native operator desk under Electron user-data `bcn-desk.json`. Its weekly blocks govern only the context Nova speaks: show intros/outros/tone and approved requests. They **do not automatically switch AutoDJ playlists or start broadcasts**. **Fixed this iteration:** blocks can refer to a registered program by ID, display its name, and show whether a generated program is scheduled.
3. **Legacy React One-Off Scheduler** persists independent `spider.scheduler.shows` and `spider.scheduler.profiles` localStorage data. Its `setTimeout` timers can call `AutoDJ.start(playlistId)` and `AutoDJ.stop()`, completely separately from the BCN Show Clock. **Still a migration risk.** This update preserves its stored entries and existing timing behavior but exposes the legacy schedule count in BCN Media and provides an *explicit, session-only* operator action to stop legacy timers without deleting entries. We have **not** silently converted one-off ISO dates into recurring weekly shows because that changes their meaning.

The new canonical authoring route is **Playlist Workshop > Save show to BCN Scheduler > BCN Media: choose the generated show and weekday/time**. The old React Show Generator navigation redirects to the Workshop. React AutoDJ stays available as the playback/playlist implementation and for pre-existing legacy one-off events.

### Multiple DJ voice engines

- Compiled **legacy AutoDJ host** had `_announce()` that tried an unrelated `spider.synthesizeSpeech()` and fell back to browser `speechSynthesis`. Those weren't native Nova DJ breaks and can sound robotic. A text-only station ID could also be enqueued with no `url`, causing a *blank upcoming song*. **Fixed this iteration:** compiled legacy automatic announcements and text-only interstitial injections are retired; only URL-bearing tracks may enter AutoDJ music playback. Native Nova owns station IDs, live liners, music ducking and break audio.
- Compiled **Nova DJ Control** uses the player events `trackStarted`/`trackEnding` and posts `/dj/prepare`. The Media Center IPC adapter intercepts only that loopback path and forwards the request to the native Spider OS `spider-ai-dj.service`. The renderer queues the returned audio and mixes it with speaker and BCN listener output. **It must be enabled in Nova DJ Control** to generate live breaks. This is the authoritative on-air speech path.
- Native **Nova TTS** previously fell back from Natasha to Matilda to eSpeak silently. The paired Spider OS change now tries the actual Australian **Matilda Piper offline voice first** for auto, honors other selected Piper speakers, permits Natasha online, and refuses robotic eSpeak on air. When neural synthesis is unavailable it raises an error, so the music continues without a robotic announcement. The `/dj/voices` endpoint and prepare result report the **actual voice engine used**, the selected profile and fallback/error status. Selecting a profile by itself did not previously prove that that voice was heard.
- **Talk to Spider/Webbie legacy assistant** has separate browser speech in the React app. That is not an on-air Nova break and remains a **different UI workflow**. Removing/changing that legacy assistant's speech requires separate Webbie integration; it is not asserted as fixed by this radio upgrade.

### Other overlapping stores and controls
- **Music library/queue:** `spider-player-state-v2` localStorage is the actual Electron player state. **Clear Up Next** and **Remove Blank Rows** affect only the queue. Music Library Cleanup audits saved local file references and optionally saved playlists and creates a backup. Neither edits ID3 tags. **Unknown Artist** means missing/blank metadata too; the temporary BCN exception does not establish broadcasting rights.
- **AutoDJ rotation/host:** compiled `spider.autodj.*` localStorage stores playlists, rotation settings, host prefs and legacy recovery. Playlist Workshop uses the *same* compiled AutoDJ playlist API rather than a new independent playback engine. The legacy host settings still exist for interoperability, but legacy robotic announcements are not used.
- **BCN live broadcaster:** Electron `radio:* ` and Cloudflare link are separate from native Nova and the programming desk. Neither saving nor scheduling a show starts a public broadcast. Stream reachability is not proof of audible listener playback.

## Current operator flow after this patch
1. Import music. Correct artist metadata as possible. Review the temporary Unknown Artist exemption before broadcasting.
2. Open **PLAYLIST WORKSHOP** (the compiled Show Generator nav also routes here). Create your BCN show and save it.
3. Open **BCN MEDIA > BCN Show Clock**. The new show appears under generated programs, initially **NOT SCHEDULED**. Select it, select weekday/start/end, then **Schedule show**.
4. To play manually, select **Start playlist manually** for the program. This arms AutoDJ; it doesn't open the public broadcast.
5. In **Nova DJ Control**, enable genuine Nova DJ breaks. In **BCN MEDIA > Nova**, select Matilda/Kirra/etc. and check **actual voice engine** after a prepared break. If neural audio fails, check the diagnostic; no robot voice should be inserted.
6. Check legacy one-off AutoDJ timer count in BCN Media before using a new weekly timetable. If a conflicting old timer is active, the operator can stop *legacy timers for this session*. Existing legacy records are retained.
7. Start/stop the public broadcaster separately. Verify actual listener audio on another device.

## Validated vs not validated

**Automated tests cover:** native registry persistence and playlist linkage, request approvals, compiled legacy speech and empty-liner removal, adapter voice metadata, pinning of the paired Nova source, installer syntax, packaging consistency and existing playback/visualizer/radio regression suites.

**Not yet device-verified:** installed Webbie Piper model executable at the expected path; local speaker voice quality; GPU/visualizer compatibility; actual BCN audio streaming; one-off and weekly schedule interactions across long runtimes; listener microphone/speaker routing; correct Python and Electron runtime updates on Spider OS. No installation was performed by repository merge.

## Remaining priorities

1. **Native voice acceptance:** on the target desktop check `curl --noproxy '*' -fsS http://127.0.0.1:9876/dj/voices`, ensure `piperReady` is true, select Matilda, trigger a test break and verify `lastVoice.engine` and audible audio. Inspect `journalctl --user -u spider-ai-dj.service` if it fails.
2. **One scheduler migration:** plan a reversible import/archival path for legacy **one-off** shows into a native programming model that supports both one-off and recurring blocks. The current BCN scheduler supports weekly day/time only, so silently importing one-off events would be wrong. Decide how/when scheduled shows should switch actual AutoDJ playlists, and require a deliberate operator arm action for live control.
3. **On-air end-to-end verification:** create, schedule, and manually start a generated show; check correct track metadata, real voice and audio ducking, cue rotation, queue cleanup, fallback behavior, and public receiver sound. Test with a safe private stream first. Do not declare unattended 24/7 operation until verified.

This source review does not endorse disabling or removing the older scheduler's records or rewriting existing playlists without inspection and backup.
