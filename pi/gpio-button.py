#!/usr/bin/env python3
"""
gpio-button.py — physical buttons for the booth.

An arcade booth wants a big illuminated button, not a touchscreen tap. This
watches GPIO pins and POSTs to the kiosk service, which pushes the event to
the browser over SSE. The browser then treats it exactly like a screen tap.

Uses gpiozero, which picks the right backend automatically — lgpio on Pi 5,
RPi.GPIO on Pi 4 and earlier. Debounce lives here, next to the hardware,
because that is where the bounce is.

Wire each button between its GPIO pin and GND; the internal pull-up handles
the rest, so no external resistors.

  START   GPIO 17  →  begin a session
  SHUTTER GPIO 27  →  print / confirm
  CANCEL  GPIO 22  →  abandon back to the attract screen
  COIN    GPIO 23  →  optional pulse input from a coin acceptor

  python3 pi/gpio-button.py
"""

import json
import os
import sys
import time
import urllib.request

API = os.environ.get("HOLOBOOTH_API", "http://127.0.0.1:4180/api/gpio")
BOUNCE = float(os.environ.get("HOLOBOOTH_BOUNCE", "0.08"))

PINS = {
    int(os.environ.get("PIN_START", 17)): "start",
    int(os.environ.get("PIN_SHUTTER", 27)): "shutter",
    int(os.environ.get("PIN_CANCEL", 22)): "cancel",
    int(os.environ.get("PIN_COIN", 23)): "coin",
}

try:
    from gpiozero import Button
except ImportError:
    sys.exit("gpiozero is not installed.  sudo apt install -y python3-gpiozero python3-lgpio")


def post(action, pin):
    body = json.dumps({"action": action, "pin": pin, "at": time.time()}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except Exception as e:
        # The kiosk service restarting is normal; don't take the watcher down with it.
        print(f"[gpio] post failed ({e}) — is the kiosk service up?", file=sys.stderr, flush=True)


def main():
    buttons = []
    for pin, action in PINS.items():
        try:
            b = Button(pin, pull_up=True, bounce_time=BOUNCE)
            b.when_pressed = (lambda a, p: (lambda: (print(f"[gpio] {a}", flush=True), post(a, p))))(action, pin)
            buttons.append(b)
            print(f"[gpio] watching pin {pin} -> {action}", flush=True)
        except Exception as e:
            print(f"[gpio] pin {pin} unavailable: {e}", file=sys.stderr, flush=True)

    if not buttons:
        sys.exit("No GPIO pins could be opened. Is this a Raspberry Pi, and is the user in the 'gpio' group?")

    print(f"[gpio] posting to {API}", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
