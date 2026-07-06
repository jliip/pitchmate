# PitchMate

PitchMate is a compact browser-based singing practice app. It extracts a reference pitch track from an uploaded audio file, listens to the microphone, and shows whether the singer is sharp, flat, or close to the target pitch.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL in Chrome or Edge. Microphone access requires a secure context; `localhost` works.

## Deploy to GitHub Pages

This project is configured for a GitHub Pages project site using the repository name `pitchmate`.

```bash
npm run build
```

Push the project to a GitHub repository named `pitchmate`, then enable Pages with GitHub Actions as the source. After the deployment workflow completes, the app will be available at:

```text
https://<github-username>.github.io/pitchmate/
```

GitHub Pages serves over HTTPS, which satisfies the browser secure-context requirement for microphone access.

## Current MVP

- Upload a browser-supported audio file such as mp3, wav, or m4a.
- Extract a reference pitch curve with a local YIN detector.
- Play, pause, seek, and restart the reference track.
- Capture live microphone pitch and compare it to the synchronized reference pitch.
- Show note names, cents deviation, hit/close/miss feedback, and a basic score.

## Important Limitation

The first version expects vocals-forward audio or a pre-separated vocal track. Fully automatic vocal isolation from arbitrary mixed songs usually needs a heavier model such as Demucs or Spleeter. A practical next step is to add a local Python preprocessing command that generates a vocals-only file or pitch JSON, then load that result into this app.