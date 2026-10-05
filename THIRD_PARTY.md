# Third-party technology notes

Spider Media Center may incorporate or link third-party open-source media technology.

## VideoLAN / libVLC

Planned use: media engine, protocol, demuxing, decoding and network-media capabilities.

VideoLAN states that libVLC is an embeddable C library licensed under LGPL 2.1, while the VLC media player interface remains GPL and individual modules may have their own licensing history.

Before shipping reused code or binaries, verify the license of the exact upstream version/file and include all required notices and source obligations.

Official upstream project: VideoLAN / VLC.

## FFmpeg and other codec libraries

Spider Media Center may also depend on codec libraries brought in by the chosen media engine. Their licenses vary by build configuration and enabled codecs. Distribution work must audit the exact binary build, not assume one blanket license.

This file is a project tracking note, not legal advice.
