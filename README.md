# PitchMate

[中文](README_zh.md)

PitchMate is a browser-based singing practice app for checking pitch against a reference track.

Live site: https://jliip.github.io/pitchmate/

## Features

- Upload an audio file as the reference track.
- Extract a pitch curve from the reference audio in the browser.
- Use the microphone to compare live singing with the target pitch.
- Show whether the singer is sharp, flat, or close to the target.
- Display note names, cents deviation, timing, and a basic score.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL in Chrome or Edge. Microphone access requires a secure context; `localhost` works.

## Deploy

This project is configured for GitHub Pages at:

```text
https://jliip.github.io/pitchmate/
```

Build command:

```bash
npm run build
```
