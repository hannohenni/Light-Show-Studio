# Tesla Light Show Desk

A self-contained web app for turning a song into a Tesla light show. Load an audio file,
let it choreograph the show automatically, tweak it on the timeline, and download a
ready-to-copy `LightShow` folder for the USB stick.

Everything runs in the browser. No PHP, no Node, no database, no internet access, no build
step. The whole thing is one folder of static files, so it works from Synology Web Station,
any other web server, or even by opening `index.html` directly from disk.

---

## Install on a Synology NAS (DSM 7)

1. **Package Center → install Web Station.** During setup it also installs the Apache or
   Nginx back end; either one is fine, since nothing here runs server-side.
2. Web Station creates a shared folder called **`web`**. Copy this whole folder into it so
   you end up with `/web/tesla-lightshow/` containing `index.html`.
3. In **Web Station → Web Service**, confirm a service points at the `web` folder (on a
   fresh DSM 7 install, the default "Default Server" portal already does).
4. Browse to **`http://<nas-ip>/tesla-lightshow/`** from any computer on the network.

Notes:

- Chrome, Edge, Firefox, and Safari all work. It needs the Web Audio API and canvas, both
  of which have been standard for years.
- Audio decoding and analysis happen on the *client* machine, not the NAS, so a big song
  won't tax the NAS CPU at all.
- No HTTPS is required. Nothing here uses APIs that browsers restrict to secure contexts.
- Projects autosave to the browser's local storage, keyed by the song's filename, so
  reopening the same track offers to restore your work. Use **Save project** for anything
  you want to keep properly.

---

## Making a show

1. **Drop in a song.** MP3 or WAV is ideal. The app decodes it, draws the waveform, and
   analyses it: onsets, five frequency bands, tempo, beat grid, and bars grouped in fours
   with an energy level and drop detection.
2. **Check the tempo.** The detected BPM and first-beat offset appear in the Tempo card.
   Watch the grid lines against the waveform for a few seconds. If the show is going to
   feel half or twice as fast as the music, press **÷2** or **×2**; if the grid drifts
   slightly ahead or behind, use the **±10 ms** nudges.
3. **Auto-build.** Pick a style and intensity, then press Build:
   - **Balanced** — a bit of everything, safe for most tracks.
   - **Party** — dense, strobe-happy, leans on the drops.
   - **Elegant** — long fades and slow sweeps, few hard cuts.
   - **Classic** — mains, signature, and turn signals doing tidy alternating patterns.

   Press **↻** to reroll with a new random seed. Same music, different show.
4. **Edit anything.** Drag along a lane to paint a block, Alt-drag to erase, click a block
   to select it, Delete to remove it. Drag across the waveform to select a range, then
   apply one of the twelve patterns from the Paint card to just that range.
5. **Watch the car.** The stage preview shows a top-down car with every lamp glowing in
   its real colour, and closures that move at the durations Tesla actually uses — the
   liftgate takes its full 14 seconds to open, the doors 22.
6. **Export.** The dialog reports the frame count, duration, file size, and any validator
   complaints. Download the ZIP and unzip it onto the USB stick.

---

## Getting it into the car

- The USB stick must be **FAT32 or exFAT**, with a top-level folder named exactly
  **`LightShow`**. The ZIP unzips to exactly that.
- The `.fseq` and the audio file must share the same base name — `myshow.fseq` and
  `myshow.wav`. The export does this automatically.
- **Audio must be 44.1 kHz.** If your source isn't already a 44.1 kHz MP3 or WAV, the app
  converts it to a 44.1 kHz WAV on export. That's the single most common reason a show
  fails to load in the car.
- Plug the stick into a USB port that supports data (in most models, the glovebox port or
  the front console ports), then open **Toybox → Light Show**.
- Park outside, in Park, with the doors closed. The car refuses to run a show otherwise.

---

## What it writes

Standard **FSEQ v2.0, uncompressed, 48 channels**, at your chosen step time (20 ms
default). This is the universal format every light-show-capable Tesla accepts. The
200-channel Cybertruck mode, which addresses the light bar as RGB, is deliberately not
supported here — a 48-channel file still runs fine on a Cybertruck.

The exporter's output has been checked against Tesla's own `validator.py` from
`github.com/teslamotors/light-show`, which accepts it.

### Channel map

| # | Channel | # | Channel | # | Channel |
|---|---------|---|---------|---|---------|
| 1 | Left outer main | 17 | Left aux park | 33 | Left front door |
| 2 | Right outer main | 18 | Right aux park | 34 | Right front door |
| 3 | Left inner main | 19 | Left side marker | 35 | Left mirror |
| 4 | Right inner main | 20 | Right side marker | 36 | Right mirror |
| 5 | Left signature | 21 | Left side repeater | 37 | Left front window |
| 6 | Right signature | 22 | Right side repeater | 38 | Left rear window |
| 7 | Left channel 4 | 23 | Left rear turn | 39 | Right front window |
| 8 | Right channel 4 | 24 | Right rear turn | 40 | Right rear window |
| 9 | Left channel 5 | 25 | Brake lights | 41 | Liftgate (frunk on Cybertruck) |
| 10 | Right channel 5 | 26 | Left tail | 42 | Left front door handle |
| 11 | Left channel 6 | 27 | Right tail | 43 | Left rear door handle |
| 12 | Right channel 6 | 28 | Reverse lights | 44 | Right front door handle |
| 13 | Left front turn | 29 | Rear fog | 45 | Right rear door handle |
| 14 | Right front turn | 30 | License plate | 46 | Charge port |
| 15 | Left front fog | 31 | Left falcon door | 47 | *(unused)* |
| 16 | Right front fog | 32 | Right falcon door | 48 | *(unused)* |

### Channel values

**Lights** — `0` off · `25` fade off over 0.5 s · `51` fade off over 1 s ·
`76` fade off over 2 s · `178` fade on over 0.5 s · `204` fade on over 1 s ·
`229` fade on over 2 s · `255` on.

Only the main, signature, channel 4/5/6, and fog channels support the fade values; the
rest are on or off, and the app only offers ramps on the channels that have them.

**Closures** — `0` idle · `63` open · `127` dance · `191` close · `255` stop. Dance only
works on a closure that's already open, windows excepted.

### Closure limits per show

The auto-builder and the Show check panel both enforce these:

| Closure | Moves | Open | Close |
|---------|-------|------|-------|
| Liftgate | 6 | 14 s | 4 s |
| Front doors | 6 | 22 s | 3 s |
| Falcon doors | 6 | 20 s | 8 s |
| Windows | 6 | 4 s | 4 s |
| Mirrors | 20 | 2 s | 2 s |
| Door handles | 20 | 2 s | 2 s |
| Charge port | 3 | 2 s | 2 s |

---

## Keyboard

| Key | Action |
|-----|--------|
| Space | Play / pause |
| Z | Zoom to fit |
| Ctrl/⌘ + Z | Undo (Shift to redo) |
| Delete | Delete the selected block, or clear the selected range |
| ← → | Nudge the playhead by a beat |
| + − | Zoom in / out |
| Esc | Clear the selection |

---

## Files

```
index.html          layout and dialogs
css/app.css         all styling
js/channels.js      the 48-channel map, groups, and value constants
js/fseq.js          FSEQ v2.0 reader, writer, and validator
js/zip.js           store-only ZIP writer
js/doc.js           the show document: 48 lanes of timed blocks
js/audio.js         decode, sample-rate sniffing, WAV export, FFT, beat tracking
js/generator.js     the auto-choreographer
js/stage.js         top-down car preview
js/timeline.js      the editor canvas
js/app.js           glue: files, playback, undo, export
```

Nothing loads from a CDN and there are no external fonts, so it works on an isolated
network exactly as well as it does online.
