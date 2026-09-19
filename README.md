# Aaina

A private 30-second voice check-in for mental wellbeing. It listens to how you sound (pitch variation, jitter, shimmer, pauses, speech rhythm) and reflects back tension and low energy, with a trend over days.

- Runs fully on the phone. Audio is never saved or uploaded. Only a few numbers go into localStorage.
- Wellness tool, not a medical device. It cannot diagnose anything.
- No build step: plain HTML, CSS and JS. Installable as a PWA.

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000 (localhost counts as secure for the mic)

## Deploy (free)
GitHub repo, Settings, Pages, Deploy from branch `main` / root. The phone needs the https link.

## Files
- `dsp.js`   pitch tracker, cycle-level jitter/shimmer, pauses, rhythm, scores (`RANGES` = calibration)
- `app.js`   recording, orb, results, trends, storage
- `sw.js`    offline cache (network-first, so updates appear right away)

## Calibrating (do this at the hackathon)
Open "See the numbers" after a check-in. Record calm and stressed samples from a few people, then adjust `RANGES` in `dsp.js` so calm reads Low and stressed reads High.
