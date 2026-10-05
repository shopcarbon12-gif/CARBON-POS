# Carbon Print Agent

A small program that runs on one computer inside the store and sends
every POS print (receipts, register reports, cash drawer kicks) to the
receipt printer over the store network.

With it running, the registers never talk to the printer directly. That
means no "accept the certificate" page and no Chrome "access devices on
your local network" prompt, on any device. If the agent is off, the POS
automatically falls back to printing straight from the browser like
before.

## What you need

- A Windows PC in the store that stays on during business hours and is on
  the same network as the printer (a register PC is fine).
- The printer's IP set in **POS → Settings → Locations → Receipt printer
  host** (e.g. `192.168.1.22`, port `9100`). Ideally give the printer a
  fixed IP in the router so it never changes.

## Setup (one time, about 10 minutes)

1. **Install Node.js** — download the "LTS" Windows installer from
   <https://nodejs.org> and click through it with the defaults.
2. **Copy this folder** to the PC, e.g. `C:\CarbonPrintAgent`. It needs
   `carbon-print-agent.mjs`, `start-print-agent.bat` and
   `config.example.json`.
3. **Get the agent key** — in the POS go to **Settings → Locations**, find
   the store, and click **Set up print agent**. Copy the key it shows (it
   is shown only once).
4. **Create the config** — in the folder, copy `config.example.json` to
   `config.json`, open it in Notepad and paste the key:

   ```json
   {
     "server": "https://pos.shopcarbon.com",
     "token": "cpa_...the key..."
   }
   ```

5. **Test the printer connection** — open Command Prompt in the folder
   and run:

   ```
   node carbon-print-agent.mjs --test 192.168.1.22
   ```

   A short "Carbon print agent test" slip should print.
6. **Start it** — double-click `start-print-agent.bat`. A window opens
   and says `Carbon print agent v1.0.0 → https://pos.shopcarbon.com`.
   Within a few seconds Settings → Locations shows the agent as
   **Online**.
7. **Start it automatically** — press `Win + R`, type `shell:startup`,
   press Enter, and put a shortcut to `start-print-agent.bat` in that
   folder. It will then start every time the PC signs in. (Right-click
   the shortcut → Properties → Run: **Minimized** to keep it out of the
   way.)

## Day to day

- Leave the agent window open (minimized is fine). Closing it stops the
  relay; the registers fall back to browser printing.
- Everything it does is logged to `print-agent.log` in the same folder.
- If a print fails, the POS screen shows the agent's reason (printer off,
  out of paper, wrong IP).
- Jobs not picked up within 2 minutes are dropped, so an old receipt
  never prints hours later when the PC comes back.

## Changing or removing it

- **New key** (e.g. moving the agent to another PC): Settings → Locations
  → **New key**, then paste it into `config.json` on the PC that runs
  the agent. The old key stops working right away.
- **Turn off**: Settings → Locations → **Turn off**. Registers go back to
  printing straight from the browser.
