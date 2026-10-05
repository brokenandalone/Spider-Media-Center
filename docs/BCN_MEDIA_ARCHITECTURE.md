# Broken City Network media architecture

Spider Media Center is evolving from a desktop player into the playback and broadcast console for **Broken City Network (BCN)**.

## Design goals

1. Keep the working 7.5/Kabel playback and broadcast baseline intact.
2. Rename the public-facing station identity from Spider Radio to **Broken City Network (BCN)**.
3. Add international radio discovery for talk, news, speech and music stations.
4. Load M3U/M3U8 IPTV playlists, including the public iptv-org catalog.
5. Use VLC/libVLC as the compatibility layer for formats and network protocols Chromium cannot reliably play.
6. Make the AI DJ portable so its runtime, prompts, voice assets and optional model can live on a USB drive.
7. Make the AI DJ behave like a radio host, not a text-to-speech announcement button.

## Playback architecture

Spider Media Center will **not** launch VLC as a fallback player.

The long-term design is one Spider-native media engine with the Spider interface, Spider state model, Spider broadcast mixer and BCN workflow. Where practical, that engine can reuse or embed appropriate open-source VLC/libVLC playback technology and modules instead of reinventing protocol, demuxing and codec support.

### Spider native playback core

The engine should own:

- local playback
- HLS and M3U8
- RTSP
- transport streams
- unusual codecs and containers
- international radio streams
- IPTV
- network filesystems and DLNA/UPnP later
- removable media and discs later
- audio/video output routing into Spider's mixer and broadcast graph

The important rule is that VLC is **source technology**, not a separate player launched beside Spider.

VideoLAN documents libVLC as an embeddable C library under LGPL 2.1, and many playback modules were relicensed to LGPL. VLC's desktop interface remains GPL, so Spider should reuse only code/modules whose licenses are compatible with the project and preserve required notices and source obligations.

### Browser/service handoff

Web services that require their own web application or protected playback stay in a sandboxed service window.

Spider may pass supported public URLs to VLC where normal VLC playback works. Spider should not contain code whose purpose is to defeat DRM, paywalls, access controls or advertising systems.

## IPTV

Default public catalog:

```text
https://iptv-org.github.io/iptv/index.m3u
```

Spider should parse M3U metadata into searchable channels and allow filtering by country, language and category.

A channel should be playable through the native engine when possible and through VLC fallback when needed.

## International radio

Use Radio Browser as a directory, not as the audio transport itself.

Useful station filters:

- country code, such as AU or GB
- language
- tags such as talk, news and speech
- station name

Selected stations are normal network-stream queue items.

### BCN rebroadcast

Playing a station locally and retransmitting it are different operations. BCN can technically route an external station into the broadcast mix, but the UI should require an explicit confirmation that the operator has permission to rebroadcast the source.

## Broken City Network naming

Public-facing labels should use:

- Broken City Network
- BCN
- BCN Broadcast Studio
- BCN LIVE

Internal IPC/channel names may remain `radio:*` for compatibility until a later cleanup.

## Portable AI DJ

The preferred removable-drive layout is:

```text
SPIDER_DJ/
├── spider-dj.json
├── service/
│   ├── service.py
│   ├── prompts/
│   └── voices/
├── model/
│   └── optional-model.gguf
├── bin/
│   └── optional llama-server
└── logs/
```

The Media Center discovers a drive only when it contains the manifest file. It must never execute arbitrary files merely because a USB drive was inserted.

### Runtime modes

1. **Portable local mode**: bundled GGUF + llama.cpp + local voice assets.
2. **Spider OS mode**: service files on USB, model supplied by local Ollama.
3. **Fallback mode**: no AI model, but deterministic station IDs, liners and emergency continuity remain available.

## Real DJ behavior

The AI DJ should operate from a show clock and a state machine.

It should be able to:

- back-announce the track that just played
- front-sell the next track
- identify BCN naturally
- give time checks
- use short liners and sweepers
- vary phrasing instead of repeating canned intros
- respect an intro window and avoid speaking over vocals when metadata permits
- talk over an outro/ramp when safe
- duck program audio under the voice
- handle approved requests
- mention listener messages
- run scheduled segments
- insert sponsor/promotional copy
- recover from silence
- know the current and next track before speaking
- keep talk breaks short unless a long-form segment is scheduled
- never invent news, weather, traffic or factual updates without a real data source

The DJ should produce structured output such as:

```json
{
  "type": "transition",
  "script": "...",
  "talkOver": {
    "startSecondsBeforeEnd": 9,
    "duckLevel": 0.28,
    "crossfadeSeconds": 3
  },
  "nextTrackId": "..."
}
```

Spider Media Center owns timing and audio mixing. The AI proposes the break; the player decides when it is safe to execute it.

## Source policy

Spider can provide generic web-service launchers and normal URL playback. It should not scrape protected movie sites or extract protected streams. Services such as LookMovie should remain external browser destinations rather than becoming built-in stream extractors.

## VLC upstream usage policy

Use VideoLAN as an upstream engineering source, not as an external fallback application.

Preferred order:

1. Embed libVLC or compatible LGPL playback modules when that gives Spider a mature implementation quickly.
2. Port narrowly scoped LGPL modules or ideas where embedding the whole engine is unnecessary.
3. Keep Spider's own UI, state model, queue, visualizer, DJ, broadcast mixer and BCN logic.
4. Track upstream license headers and notices for every reused file or module.
5. Do not copy VLC interface modules or GPL-only code into Spider unless the project intentionally adopts the corresponding GPL obligations.

This lets Spider inherit mature protocol/demux/codec work without turning the product into a reskinned VLC launcher.
