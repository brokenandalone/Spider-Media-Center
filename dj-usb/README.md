# Spider / BCN portable AI DJ

This folder defines the removable-drive version of the AI DJ.

The goal is to let the DJ personality, prompts, voice assets, show-clock rules and optional local model travel on a USB drive instead of being welded to one Spider OS installation.

## Drive marker

A valid DJ drive must contain:

```text
SPIDER_DJ/spider-dj.json
```

Spider should never auto-run random executables from an arbitrary USB drive. The manifest is the explicit marker used by the Media Center.

## Recommended layout

```text
SPIDER_DJ/
├── spider-dj.json
├── service/
│   ├── service.py
│   ├── prompts/
│   │   ├── transition.txt
│   │   ├── liner.txt
│   │   └── longform.txt
│   └── voices/
├── model/
│   └── optional-model.gguf
├── bin/
│   └── optional llama-server
└── logs/
```

## Portable mode

For a completely self-contained DJ, place a compatible GGUF model plus a llama.cpp server binary on the drive.

For Spider OS mode, the drive can hold only the DJ service/personality and use the computer's existing Ollama installation.

## Live-DJ contract

The service should listen locally, normally on:

```text
http://127.0.0.1:9876
```

It should accept a transition request containing the current track, next track, station identity, show context and timing information.

The response should contain the spoken script, audio file or URL, and timing/mix instructions.

The Media Center remains responsible for actual audio timing, ducking and crossfading.

## BCN personality

The station identity is **Broken City Network (BCN)**.

A real radio-style host should vary its language, back-announce, front-sell, use station IDs, handle requests, keep track of what has already been said, and respect a show clock.

It must not fabricate current news, weather, traffic or other factual claims when no live source has supplied them.
