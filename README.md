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

The Timeline view schedules each step at the earliest time its precedents allow. Blocks show durations in seconds and independent steps can run in parallel. It supports zoom and Fit; connectors move forward, seek separate tracks, pass behind cards when necessary, and come to the front when highlighted.

The Flow diagram view ignores scheduled time. It places each step in a column based on dependency depth, groups steps by component, sizes each box to its label, and shows every explicit dependency, including links between consecutive steps in one component. Click either semicircle connector to jump to the other end; hover or focus it to identify the linked step. Missing references, duplicate IDs, malformed rows, invalid durations, and dependency cycles are reported in the UI.


## Tests

Run the focused logic and CSV tests with Node.js:

```sh
node --test app.test.js
```
