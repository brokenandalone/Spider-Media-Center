# Spider Native Media Engine

Spider Media Center does not use the VLC desktop application as a fallback.

The target is a **Spider-native media engine** that can embed or reuse suitable open-source VLC/libVLC technology while keeping Spider's own UI, queue, playback state, visualizers, DJ automation, broadcast mixer and BCN workflow.

## What we want from VideoLAN technology

High-value areas include:

- network protocol support
- HLS / M3U8
- RTSP
- demuxers
- decoders
- transport streams
- subtitle handling
- hardware decoding
- network discovery
- DLNA / UPnP
- casting
- optical/removable media support

## What stays Spider-native

These remain owned by Spider Media Center:

- UI and navigation
- Now Playing
- queue and library model
- dual-deck behavior
- crossfades
- EQ / stereo controls
- visualizers
- AI DJ
- BCN broadcast state
- microphone and program mix
- recording
- Nearby Share
- Party DJ
- phone remote
- Spider OS / Webbie integration

## Licensing rule

VideoLAN documents libVLC as LGPL 2.1 and many playback modules were relicensed to LGPL, but the VLC desktop interface remains GPL.

Before copying or modifying any upstream file:

1. record its upstream path and exact license;
2. preserve copyright and license headers;
3. avoid GPL-only interface code unless Spider intentionally adopts the corresponding GPL obligations;
4. keep a third-party notice and source-offer strategy for redistributed LGPL/GPL components;
5. prefer linking or clean modular reuse over copying large unrelated chunks.

## Integration phases

### Phase 1

Keep the current 7.5 playback engine working while building a native media-core boundary.

### Phase 2

Integrate network protocols and demuxing for IPTV, talk radio and arbitrary network streams.

### Phase 3

Route decoded audio/video back into Spider's playback and broadcast graph so BCN can process the media rather than handing playback to another app.

### Phase 4

Add network discovery, DLNA/UPnP, casting, TV-channel organization and richer video output.

The goal is not “VLC inside a window.” The goal is Spider Media Center with a mature open-source media core.
