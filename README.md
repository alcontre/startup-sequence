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

IDs must be unique. Durations must be positive numbers in a consistent unit throughout the file. Separate multiple precedent IDs with semicolons. Labels and other fields may be quoted using standard CSV double-quote escaping.

The timeline places each step at the earliest time its precedents allow; independent steps can run in parallel. Step cards are vertically centered within their swimlane rows, with crowded rows stacked and centered as a group. Dependency arrows spread across the source and target edges to reduce overlap; hover an arrowhead to see its prerequisite, or its source dot to see the next step. Proportional mode scales block width to duration. Equal-width mode keeps the same scheduled positions while rendering all blocks at a fixed width. Use the zoom slider or +/- buttons to inspect the timeline, and Fit to see its full duration at once; the diagram also scrolls horizontally and vertically when needed. Missing references, duplicate IDs, malformed rows, invalid durations, and dependency cycles are reported in the UI.

## Tests

Run the focused logic and CSV tests with Node.js:

```sh
node --test app.test.js
```
