# Startup Sequence Visualizer

A client-only browser tool for editing and visualizing embedded-system startup tasks across component swimlanes. No server, package installation, or external runtime dependency is required.

## Run

Open `index.html` in a modern browser. The app starts with a made-up 30-step boot sequence spanning several CPUs, storage, a secure engine, and an FPGA. Its durations are in seconds, with parallel work and a critical path lasting well over a minute. Edit or clear it, import your own CSV, and export the current sequence when finished. Data remains in the browser and is not sent to a server.

## CSV format

Use one row per step, with these required headers:

```csv
id,lane,label,duration,precedents
rom-init,CPU 0,Boot ROM init,2,
key-exchange,Security,Key exchange,1,rom-init
load-files,Storage,Load startup files,4,rom-init
decrypt-image,Security,Decrypt firmware,2,key-exchange;load-files
```

IDs must be unique. Durations must be positive numbers in seconds. Separate multiple precedent IDs with semicolons. Labels and other fields may be quoted using standard CSV double-quote escaping.

The timeline places each step at the earliest time its precedents allow; independent steps can run in parallel. Proportional blocks represent duration, with a small visual gap separating consecutive steps. Equal-width blocks retain scheduled start positions and use additional rows whenever their visible cards overlap. Same-lane dependencies are implicit only when consecutive steps share a row. Other dependencies use rounded connectors that always move forward across the timeline. Routes reserve separate tracks and penalize overlap and crossings; busy time boundaries receive wider visual gaps when card widths allow it. At very small zoom levels, track spacing compresses to fit the available space. They route around cards when possible and pass behind them when necessary; highlighting brings the full connection in front. In equal-width mode, a connection may end at the target card's right edge to preserve forward direction. Both ends have visible semicircle connectors: hover or focus one to inspect its linked step, or activate it to jump to the other end. Labels are clipped within cards; hover a card for its full label, ID, start, finish, and duration. Use zoom or Fit to inspect the timeline. Missing references, duplicate IDs, malformed rows, invalid durations, and dependency cycles are reported in the UI.


## Tests

Run the focused logic and CSV tests with Node.js:

```sh
node --test app.test.js
```
