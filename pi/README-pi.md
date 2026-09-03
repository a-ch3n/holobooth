# HoloBooth on a Raspberry Pi

The desktop build runs on Electron. The Pi build doesn't, and shouldn't:
Electron ships its own Chromium (~250 MB, x64-first, no video acceleration on
this hardware) while Raspberry Pi OS already has a Chromium built for the Pi
with VA-API decoding. So the Pi build keeps the entire UI and swaps the shell:

```
desktop                        raspberry pi
─────────                      ────────────
Electron window          →     chromium-browser --kiosk
Electron main process    →     pi/kiosk-server.mjs      (node, ~30 MB RSS)
webContents.print()      →     CUPS via lp, exact-size PDF
preload.js bridge        →     JSON-RPC over localhost
—                        →     GPIO buttons (SSE to the browser)
```

`src/js/bridge.js` picks the backend at boot, so **no application code differs
between the two platforms**. The same `app.js`, the same card engine, the same
`renderCard()` producing the same 750×1050 print master.

---

## Install

Flash **Raspberry Pi OS Bookworm (64-bit)**, boot it, then:

```bash
git clone <your repo> holobooth && cd holobooth
sudo bash pi/install.sh
```

The installer is idempotent — re-run it after any update. It installs Node,
Chromium, CUPS with Gutenprint, v4l-utils and gpiozero; copies the app to
`/opt/holobooth`; installs four systemd units; and disables screen blanking.

Then three things it can't do for you:

1. **Name your printer.** `lpstat -e` lists them; put the exact name in
   `printing.cardPrinterName`.
2. **Name your capture card.** `v4l2-ctl --list-devices` shows it; put a
   distinctive substring in `camera.preferredLabels`.
3. **Add your Stripe key** to `/etc/holobooth/stripe.env`, then
   `systemctl enable --now holobooth-payments`. Until then the booth runs on
   `mock` payments — deliberately, because a booth that takes money it can't
   process is worse than one that's obviously offline.

```bash
systemctl status holobooth-kiosk
journalctl -u holobooth-kiosk -f
```

---

## Which Pi

| Model | Verdict |
|---|---|
| **Pi 5 (4 or 8 GB)** | What to build on. USB 3.0, fast enough that card rendering is imperceptible. |
| **Pi 4B (4 GB+)** | Fine. Card render takes ~2× the Pi 5 but still well under the reveal animation. |
| Pi 4B 2 GB | Workable, but Chromium plus a 1080p capture stream is tight. Add zram. |
| Pi 3 / Zero 2 W | **No.** USB 2.0 only — see below. |

### The USB bandwidth problem

This is the constraint that decides your Pi, so it's worth being concrete.

A 1080p30 capture card sending **uncompressed YUYV** needs
`1920 × 1080 × 2 bytes × 30 fps ≈ 124 MB/s`. USB 2.0 tops out around 35 MB/s in
practice. It cannot be done — the Pi 3 and Zero will either negotiate down to
480p or drop frames until the stream dies.

Two things make it work:

1. **Use a USB 3.0 port** (the blue ones) on a Pi 4 or Pi 5.
2. **Force MJPEG**, which is compressed at the card and roughly 10× smaller.
   Most capture cards offer both; Chromium usually picks MJPEG at 1080p on its
   own, but check:

```bash
v4l2-ctl -d /dev/video0 --list-formats-ext
```

You want `[0]: 'MJPG'` present with a 1920×1080 entry. If your card only offers
`YUYV`, run it at 720p — the card is 750×1050 at 300 dpi, and a 720p frame
cropped to portrait still gives you more pixels than the art window needs.

On a Pi 4, don't put the capture card and the dye-sub printer on the same USB 3
controller if you can avoid it — dye-subs pull a lot of bandwidth mid-print.

---

## Printing

Dye-subs are unforgiving about geometry. Hand CUPS a page that isn't exactly the
media size and the driver silently scales it: your 2.5×3.5″ card arrives at
2.42×3.39″ and no longer fits a sleeve.

A PNG carries no physical size, so `lp` has to guess. A PDF carries a MediaBox
in points, which is unambiguous. So `pi/print.mjs` takes the browser's JPEG,
wraps it in a one-page PDF whose MediaBox is exactly 180×252 pt, and prints it
with scaling off:

```
lp -d CARD -n 1 -o media=Custom.2.5x3.5in -o print-scaling=none -o fit-to-page=false card.pdf
```

No ImageMagick, no Ghostscript — PDF carries a JPEG bitstream verbatim via
`/DCTDecode`, so the wrapper is about sixty lines and has no dependencies. That
matters on a Pi, where every apt package is more SD card and more to go wrong.

**Setting up the printer:**

```bash
lpinfo -v                                  # find the usb:// URI
lpinfo -m | grep -i -e dnp -e citizen       # find the driver
sudo lpadmin -p CARD -E -v "usb://DNP/DS620" -m "gutenprint.5.3://dnp-ds620/expert"
lpoptions -p CARD -l                       # what options this driver accepts
```

Put anything driver-specific into `printing.lpOptions` in `booth.config.json`,
e.g. `["StpQuality=Photo", "ColorModel=RGB"]`.

Set `printing.dryRun: true` to have the service build the PDF and log the exact
`lp` command without printing. Use it to burn in the flow without burning ribbon.

**Media:** most dye-subs only load 4×6. `printing.sheet.enabled` is the config
for ganging cards onto a 4×6 with cut marks — cheaper and much faster than
single-card media. (Still stubbed; see the main README.)

---

## Physical buttons

An arcade booth wants a big lit button, not a touchscreen tap.
`pi/gpio-button.py` watches GPIO and POSTs to the kiosk service, which pushes
the press to the browser over SSE — the UI treats it exactly like a tap.

| Pin (BCM) | Action |
|---|---|
| 17 | START — begin a session |
| 27 | SHUTTER — print / confirm |
| 22 | CANCEL — back to attract |
| 23 | COIN — pulse from a coin acceptor |

Wire each button between its pin and GND. Internal pull-ups are enabled, so no
external resistors. Debounce happens in Python, next to the hardware where the
bounce actually is.

gpiozero picks its own backend — lgpio on Pi 5, RPi.GPIO on Pi 4 — so the same
script works on both. Change pins in `config.pi.gpio` or via `PIN_START` etc.

The `/api/gpio` endpoint refuses anything that isn't loopback. Nothing on the
venue's wifi should be able to press the booth's buttons.

---

## Surviving a real event

**Power loss is the normal shutdown.** Someone will unplug the booth. The
ledgers are append-only JSONL for exactly this reason — an `appendFile` that
completes is durable, where a half-written database file is not. To go further,
put the rootfs in overlay mode (`raspi-config` → Performance → Overlay File
System) and mount `/var/lib/holobooth` as the one writable partition. Then a
yank can't corrupt anything that matters.

**SD cards die from writes.** Install `log2ram`, or send journald to RAM:

```
# /etc/systemd/journald.conf
Storage=volatile
RuntimeMaxUse=64M
```

Better: run the whole thing off a USB SSD. A Pi 5 boots from USB by default and
an SSD removes the single most common failure mode in kiosk deployments.

**Heat.** Chromium plus a 1080p capture stream will hold a Pi 5 in the 70s °C.
Use the active cooler. `app.info` reports CPU temperature in the operator panel.

**Back up the ledgers between events.** `/var/lib/holobooth/cards.jsonl` is the
season's mint history — lose it and the 412th Blazepup becomes the 1st again.

```bash
rsync -av pi@booth.local:/var/lib/holobooth/*.jsonl ./backups/
```

---

## Performance notes

Card rendering is canvas 2D at 750×1050. On a Pi 5 that's roughly 120–200 ms;
on a Pi 4, 300–450 ms — both hidden entirely behind the reveal animation.

If you're on a slower Pi and it shows:

- Drop `capture.burst.frames` from 12 to 8. GIF encoding is the single most
  expensive step in a session and it scales linearly with frames.
- Set `delivery.gif.width` to 360.
- Lower `printing.dpi` to 300 (already the default — don't go to 600, dye-subs
  are 300 native and you'd only be making the Pi do four times the work for a
  print the hardware can't reproduce).

Chromium's canvas is GPU-accelerated on the Pi via the V3D driver, which the
kiosk unit enables with `--ignore-gpu-blocklist`. If rendering looks
suspiciously slow, check `chrome://gpu` — "Canvas: Hardware accelerated" is what
you want.

---

## Running it without the installer

For development on a Pi (or any Linux box):

```bash
npm install
node pi/kiosk-server.mjs
chromium-browser --kiosk --app=http://127.0.0.1:4180/src/index.html
```

Set `printing.dryRun: true` first if there's no printer attached.
