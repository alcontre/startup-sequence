(function (global) {
  "use strict";

  const CSV_COLUMNS = ["id", "lane", "label", "duration", "precedents"];
  const COLORS = [
    ["#e5f3f0", "#8fc6b9"],
    ["#fff0dc", "#efc185"],
    ["#e9edfa", "#a9b9e8"],
    ["#f8e9e9", "#e2a7a2"],
    ["#e8f1fa", "#a4c3df"],
    ["#f2eafa", "#c4a9df"],
  ];
  const SAMPLE_STEPS = [
    { id: "power-good", lane: "CPU 0", label: "Wait for power rails", duration: 2, precedents: [] },
    { id: "secure-rom", lane: "Secure Engine", label: "Verify secure boot ROM", duration: 8, precedents: ["power-good"] },
    { id: "dram-cpu0", lane: "CPU 0", label: "Train CPU 0 DRAM", duration: 18, precedents: ["power-good"] },
    { id: "cpu1-reset", lane: "CPU 1", label: "Release CPU 1 from reset", duration: 4, precedents: ["power-good"] },
    { id: "cpu2-reset", lane: "CPU 2", label: "Release CPU 2 from reset", duration: 4, precedents: ["power-good"] },
    { id: "nvme-enumerate", lane: "Storage", label: "Enumerate NVMe device", duration: 12, precedents: ["power-good"] },
    { id: "qspi-mount", lane: "Storage", label: "Mount QSPI boot partition", duration: 9, precedents: ["power-good"] },
    { id: "key-ladder", lane: "Secure Engine", label: "Derive device key ladder", duration: 15, precedents: ["secure-rom"] },
    { id: "session-key", lane: "CPU 0", label: "Exchange firmware session key", duration: 6, precedents: ["key-ladder"] },
    { id: "verify-manifest", lane: "Secure Engine", label: "Verify signed boot manifest", duration: 7, precedents: ["key-ladder"] },
    { id: "load-device-tree", lane: "Storage", label: "Read hardware device tree", duration: 5, precedents: ["nvme-enumerate"] },
    { id: "load-policy", lane: "Storage", label: "Load recovery policy", duration: 4, precedents: ["qspi-mount", "verify-manifest"] },
    { id: "auth-bootloader", lane: "Secure Engine", label: "Authenticate bootloader image", duration: 10, precedents: ["session-key", "verify-manifest", "nvme-enumerate"] },
    { id: "decrypt-bootloader", lane: "Secure Engine", label: "Decrypt bootloader image", duration: 12, precedents: ["auth-bootloader", "session-key"] },
    { id: "launch-cpu0", lane: "CPU 0", label: "Launch primary firmware", duration: 8, precedents: ["dram-cpu0", "decrypt-bootloader"] },
    { id: "transfer-cpu1", lane: "CPU 1", label: "Transfer CPU 1 firmware", duration: 16, precedents: ["cpu1-reset", "decrypt-bootloader"] },
    { id: "transfer-cpu2", lane: "CPU 2", label: "Transfer CPU 2 firmware", duration: 17, precedents: ["cpu2-reset", "decrypt-bootloader"] },
    { id: "init-cpu1", lane: "CPU 1", label: "Initialize CPU 1 runtime", duration: 14, precedents: ["transfer-cpu1", "dram-cpu0"] },
    { id: "init-cpu2", lane: "CPU 2", label: "Initialize CPU 2 runtime", duration: 15, precedents: ["transfer-cpu2", "dram-cpu0"] },
    { id: "program-fpga", lane: "FPGA", label: "Load FPGA bitstream", duration: 38, precedents: ["nvme-enumerate", "session-key"] },
    { id: "verify-fpga", lane: "FPGA", label: "Verify FPGA configuration", duration: 11, precedents: ["program-fpga"] },
    { id: "load-service-image", lane: "Storage", label: "Load system service bundle", duration: 26, precedents: ["launch-cpu0", "load-device-tree"] },
    { id: "start-ethernet", lane: "CPU 1", label: "Initialize Ethernet PHY", duration: 13, precedents: ["init-cpu1"] },
    { id: "exchange-network-key", lane: "Secure Engine", label: "Provision network credentials", duration: 8, precedents: ["verify-fpga", "key-ladder"] },
    { id: "start-services", lane: "CPU 0", label: "Start platform services", duration: 19, precedents: ["load-service-image", "verify-fpga"] },
    { id: "calibrate-sensors", lane: "CPU 2", label: "Calibrate onboard sensors", duration: 17, precedents: ["init-cpu2", "verify-fpga"] },
    { id: "mount-rootfs", lane: "Storage", label: "Mount encrypted root filesystem", duration: 12, precedents: ["load-service-image", "start-ethernet", "start-services"] },
    { id: "health-check", lane: "CPU 0", label: "Run platform health checks", duration: 9, precedents: ["calibrate-sensors", "mount-rootfs", "exchange-network-key"] },
    { id: "release-apps", lane: "CPU 0", label: "Release application processors", duration: 3, precedents: ["health-check"] },
    { id: "publish-ready", lane: "CPU 0", label: "Publish system ready state", duration: 2, precedents: ["release-apps"] },
  ];

  function normalizeSteps(steps) {
    const errors = [];
    const byId = new Map();
    const normalized = steps.map((step, index) => {
      const item = {
        id: String(step.id ?? "").trim(),
        lane: String(step.lane ?? "").trim(),
        label: String(step.label ?? "").trim(),
        duration: Number(step.duration),
        precedents: Array.isArray(step.precedents)
          ? step.precedents.map((id) => String(id).trim()).filter(Boolean)
          : String(step.precedents ?? "").split(";").map((id) => id.trim()).filter(Boolean),
        index,
      };

      if (!item.id) errors.push(`Row ${index + 1}: step ID is required.`);
      else if (byId.has(item.id)) errors.push(`Duplicate step ID "${item.id}".`);
      else byId.set(item.id, item);
      if (!item.lane) errors.push(`Step "${item.id || index + 1}": component/lane is required.`);
      if (!item.label) errors.push(`Step "${item.id || index + 1}": label is required.`);
      if (!Number.isFinite(item.duration) || item.duration <= 0) {
        errors.push(`Step "${item.id || index + 1}": duration must be a positive number.`);
      }
      if (new Set(item.precedents).size !== item.precedents.length) {
        errors.push(`Step "${item.id || index + 1}": precedent IDs must be unique.`);
      }
      return item;
    });

    for (const step of normalized) {
      for (const precedent of step.precedents) {
        if (!byId.has(precedent)) errors.push(`Step "${step.id}": precedent "${precedent}" does not exist.`);
        if (step.id && step.id === precedent) errors.push(`Step "${step.id}": a step cannot depend on itself.`);
      }
    }
    if (errors.length) return { errors, steps: [] };

    const indegree = new Map(normalized.map((step) => [step.id, step.precedents.length]));
    const dependents = new Map(normalized.map((step) => [step.id, []]));
    for (const step of normalized) {
      for (const precedent of step.precedents) dependents.get(precedent).push(step.id);
    }
    const ready = normalized.filter((step) => indegree.get(step.id) === 0);
    const scheduled = [];

    while (ready.length) {
      const step = ready.shift();
      step.start = step.precedents.reduce((latest, precedent) => {
        const required = byId.get(precedent);
        return Math.max(latest, required.start + required.duration);
      }, 0);
      step.end = step.start + step.duration;
      scheduled.push(step);
      for (const dependentId of dependents.get(step.id)) {
        indegree.set(dependentId, indegree.get(dependentId) - 1);
        if (indegree.get(dependentId) === 0) ready.push(byId.get(dependentId));
      }
    }

    if (scheduled.length !== normalized.length) {
      const cyclic = normalized.filter((step) => indegree.get(step.id) > 0).map((step) => step.id);
      return { errors: [`Dependency cycle detected among: ${cyclic.join(", ")}.`], steps: [] };
    }
    return { errors: [], steps: scheduled.sort((a, b) => a.index - b.index) };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    if (quoted) return { errors: ["CSV contains an unclosed quoted field."], steps: [] };
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (!rows.length) return { errors: ["CSV file is empty."], steps: [] };

    const headers = rows.shift().map((header) => header.trim().toLowerCase());
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    if (duplicateHeaders.length) {
      return { errors: [`CSV contains duplicate column(s): ${[...new Set(duplicateHeaders)].join(", ")}.`], steps: [] };
    }
    const missing = CSV_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length) return { errors: [`CSV is missing required column(s): ${missing.join(", ")}.`], steps: [] };

    const invalidRows = rows.flatMap((values, rowIndex) =>
      values.length === headers.length ? [] : [`CSV row ${rowIndex + 2}: expected ${headers.length} fields, found ${values.length}.`],
    );
    if (invalidRows.length) return { errors: invalidRows, steps: [] };

    const steps = rows.map((values) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      return {
        id: record.id,
        lane: record.lane,
        label: record.label,
        duration: record.duration,
        precedents: record.precedents,
      };
    });
    const validation = normalizeSteps(steps);
    return validation.errors.length
      ? {
        errors: validation.errors.map((error) => error.replace(/^Row (\d+)/, (_, rowNumber) => `CSV row ${Number(rowNumber) + 1}`)),
        steps: [],
      }
      : { errors: [], steps: validation.steps };
  }

  function escapeCsv(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(steps) {
    const rows = [CSV_COLUMNS.join(",")];
    for (const step of steps) {
      rows.push([
        step.id,
        step.lane,
        step.label,
        step.duration,
        Array.isArray(step.precedents) ? step.precedents.join(";") : step.precedents,
      ].map(escapeCsv).join(","));
    }
    return `${rows.join("\r\n")}\r\n`;
  }

  function shouldDrawDependency(source, target) {
    return source.lane !== target.lane || Math.abs(source.end - target.start) > 1e-9;
  }

  const ROUTE_TRACK_GAP = 1;

  function routeSegments(points) {
    return points.slice(1).map((end, index) => ({ start: points[index], end }));
  }

  function simplifyRoute(points) {
    const result = [];
    for (const point of points) {
      const last = result.at(-1);
      if (last && last.x === point.x && last.y === point.y) continue;
      const before = result.at(-2);
      if (before && ((before.x === last.x && last.x === point.x) ||
        (before.y === last.y && last.y === point.y))) result.pop();
      result.push(point);
    }
    return result;
  }

  // Consider simple forward routes together with the tracks already in use.
  // Overlapping or tightly bundled segments cost more than passing behind a card.
  function routeDependency(start, end, cards, { occupied = [], preferredFraction = 0.5, trackCount = 1 } = {}) {
    if (end.x < start.x) throw new Error("Dependency endpoints must move forward in time.");
    const width = end.x - start.x;
    const lead = Math.min(2, width / 8);
    const low = start.x + lead;
    const high = end.x - lead;
    const trackGap = Math.min(ROUTE_TRACK_GAP, (high - low) / Math.max(1, trackCount - 1));
    const preferred = low + (high - low) * Math.max(0, Math.min(1, preferredFraction));
    const tracks = new Set([preferred, low, high]);
    for (let i = 1; i < 16; i += 1) tracks.add(low + (high - low) * i / 16);
    for (const segment of occupied) {
      if (segment.start.x === segment.end.x) {
        for (const x of [segment.start.x - trackGap, segment.start.x + trackGap]) {
          if (x >= low && x <= high) tracks.add(x);
        }
      }
    }
    const candidates = [];
    for (const x of tracks) candidates.push({
      points: simplifyRoute([start, {x, y: start.y}, {x, y: end.y}, end]),
      preference: Math.abs(x - preferred) * 0.1,
    });
    const corridors = new Set([start.y - 8, start.y + 8, end.y - 8, end.y + 8]);
    for (const card of cards) {
      if (card.x + card.width >= start.x && card.x <= end.x) {
        corridors.add(card.y - 4);
        corridors.add(card.y + card.height + 4);
      }
    }
    for (const segment of occupied) {
      if (segment.start.y === segment.end.y && segment.end.x > start.x && segment.start.x < end.x) {
        corridors.add(segment.start.y - ROUTE_TRACK_GAP);
        corridors.add(segment.start.y + ROUTE_TRACK_GAP);
      }
    }
    for (const y of corridors) candidates.push({
      points: simplifyRoute([start, {x:low, y:start.y}, {x:low, y}, {x:high, y}, {x:high, y:end.y}, end]),
      preference: 0,
    });
    const overlap = (a, b, c, d) => Math.max(0, Math.min(Math.max(a,b), Math.max(c,d)) - Math.max(Math.min(a,b), Math.min(c,d)));
    function score(candidate) {
      let cost = candidate.preference + (candidate.points.length - 2) * 8;
      for (const {start:a, end:b} of routeSegments(candidate.points)) {
        const vertical = a.x === b.x;
        cost += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        for (const card of cards) {
          if (vertical && a.x > card.x && a.x < card.x + card.width) cost += 12 * overlap(a.y,b.y,card.y,card.y+card.height);
          if (!vertical && a.y > card.y && a.y < card.y + card.height) cost += 12 * overlap(a.x,b.x,card.x,card.x+card.width);
        }
        for (const {start:c, end:d} of occupied) {
          const otherVertical = c.x === d.x;
          if (vertical === otherVertical) {
            const separation = Math.abs(vertical ? a.x-c.x : a.y-c.y);
            if (separation < trackGap) {
              const shared = vertical ? overlap(a.y,b.y,c.y,d.y) : overlap(a.x,b.x,c.x,d.x);
              cost += shared * (trackGap-separation) * 40;
            }
          } else {
            const v = vertical ? {a,b} : {a:c,b:d};
            const h = vertical ? {a:c,b:d} : {a,b};
            if (v.a.x > h.a.x && v.a.x < h.b.x && h.a.y > Math.min(v.a.y,v.b.y) && h.a.y < Math.max(v.a.y,v.b.y)) cost += 24;
          }
        }
      }
      return cost;
    }
    let best = candidates[0], bestScore = Infinity;
    for (const candidate of candidates) {
      const candidateScore = score(candidate);
      if (candidateScore < bestScore) { best = candidate; bestScore = candidateScore; }
    }
    return best.points;
  }

  function roundedRoute(points, radius = 3) {
    if (!points.length) return "";
    const commands = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length - 1; i += 1) {
      const before = points[i - 1];
      const corner = points[i];
      const after = points[i + 1];
      const incoming = Math.hypot(corner.x - before.x, corner.y - before.y);
      const outgoing = Math.hypot(after.x - corner.x, after.y - corner.y);
      const bend = Math.min(radius, incoming / 2, outgoing / 2);
      if (bend === 0) continue;
      const entry = {
        x: corner.x - (corner.x - before.x) / incoming * bend,
        y: corner.y - (corner.y - before.y) / incoming * bend,
      };
      const exit = {
        x: corner.x + (after.x - corner.x) / outgoing * bend,
        y: corner.y + (after.y - corner.y) / outgoing * bend,
      };
      commands.push(`L ${entry.x} ${entry.y}`, `Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`);
    }
    const last = points[points.length - 1];
    commands.push(`L ${last.x} ${last.y}`);
    return commands.join(" ");
  }

  function flowStages(steps) {
    const byId = new Map(steps.map(step => [step.id, step]));
    const stages = new Map();
    function stageOf(id) {
      if (stages.has(id)) return stages.get(id);
      const step = byId.get(id);
      const stage = step.precedents.length
        ? 1 + Math.max(...step.precedents.map(stageOf))
        : 0;
      stages.set(id, stage);
      return stage;
    }
    for (const step of steps) stageOf(step.id);
    return stages;
  }

  const api = { normalizeSteps, parseCsv, toCsv, shouldDrawDependency, flowStages, routeDependency, roundedRoute, sampleSteps: SAMPLE_STEPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.StartupSequence = api;

  if (typeof document === "undefined") return;

  let steps = SAMPLE_STEPS.map((step) => ({ ...step }));
  let editingId = null;
  let proportional = true;
  let zoomPercent = 100;
  const baseScale = 52;

  const $ = (selector) => document.querySelector(selector);
  const timeline = $("#timeline");
  const messageBox = $("#messages");
  const form = $("#step-form");
  const fields = {
    id: $("#step-id"),
    lane: $("#step-lane"),
    label: $("#step-label"),
    duration: $("#step-duration"),
    precedents: $("#step-precedents"),
  };

  function setMessage(message) {
    messageBox.textContent = message;
    messageBox.hidden = !message;
  }

  function clearForm() {
    form.reset();
    editingId = null;
    $("#form-title").textContent = "Add a step";
    $("#save-step").textContent = "Add step";
    fields.id.disabled = false;
    $("#cancel-edit").hidden = true;
  }

  function stepFromForm() {
    return {
      id: fields.id.value,
      lane: fields.lane.value,
      label: fields.label.value,
      duration: fields.duration.value,
      precedents: fields.precedents.value,
    };
  }

  function validateAndRender(nextSteps) {
    const result = normalizeSteps(nextSteps);
    if (result.errors.length) {
      setMessage(result.errors.join(" "));
      return false;
    }
    steps = result.steps.map(({ id, lane, label, duration, precedents }) => ({
      id, lane, label, duration, precedents,
    }));
    setMessage("");
    render();
    return true;
  }

  function svgElement(name, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function endpointPort(x, y, radius, side, tooltip) {
    const port = svgElement("path", {
      d: `M ${x} ${y - radius} A ${radius} ${radius} 0 0 ${side === "destination-left" ? 1 : 0} ${x} ${y + radius} Z`,
      class: `dependency-${side === "source" ? "source" : "destination"}-port`,
      tabindex: 0,
      role: "button",
      "aria-label": tooltip,
    });
    port.append(svgElement("title", {}, tooltip));
    return port;
  }

  function linkEndpoint(port, counterpart, x, y, edge) {
    const jump = () => jumpToArrowEnd(counterpart, x, y);
    port.addEventListener("click", jump);
    port.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        jump();
      }
    });
    bindEdgeHighlight(port, edge);
  }

  function renderDiagram(scheduled) {
    timeline.replaceChildren();
    const lanes = [...new Set(scheduled.map((step) => step.lane))];
    const laneTop = 45;
    const axisHeight = 35;
    const left = 126;
    const scale = baseScale * zoomPercent / 100;
    const stages = proportional ? null : flowStages(scheduled);
    const measure = document.createElement("canvas").getContext?.("2d");
    if (measure) measure.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const labelWidth = (value) => measure ? measure.measureText(value).width : value.length * 6.5;
    const flowWidths = new Map();
    const columnWidths = [];
    if (stages) {
      for (const step of scheduled) {
        const width = Math.max(76, Math.ceil(Math.max(labelWidth(step.label), labelWidth(step.id)) + 24));
        flowWidths.set(step.id, width);
        const stage = stages.get(step.id);
        columnWidths[stage] = Math.max(columnWidths[stage] || 0, width);
      }
    }
    const columnXs = [];
    let flowRight = left;
    for (const width of columnWidths) {
      columnXs.push(flowRight);
      flowRight += width + 64;
    }
    const maxTime = Math.max(...scheduled.map((step) => step.end), 0);
    const chartRight = Math.max(
      $(".diagram-scroll").clientWidth,
      proportional ? left + maxTime * scale + 80 : flowRight + 16,
    );
    const laneRows = new Map();
    const cardPositions = new Map();
    const outgoing = new Map(scheduled.map((step) => [step.id, []]));
    for (const step of scheduled) {
      for (const precedent of step.precedents) outgoing.get(precedent).push(step.id);
    }
    const stepsById = new Map(scheduled.map(step => [step.id, step]));
    const boundaryConnections = new Map();
    for (const target of scheduled) {
      for (const id of target.precedents) {
        const source = stepsById.get(id);
        if (shouldDrawDependency(source, target) && Math.abs(source.end - target.start) < 1e-9) {
          boundaryConnections.set(target.start, (boundaryConnections.get(target.start) || 0) + 1);
        }
      }
    }
    const boundaryInset = (time, duration) => Math.min(
      3 + Math.max(0, (boundaryConnections.get(time) || 1) - 1) * ROUTE_TRACK_GAP / 2,
      duration * scale / 4,
    );
    const cardHeights = new Map(scheduled.map((step) => [
      step.id,
      Math.max(proportional ? 43 : 52, 18 + (Math.max(step.precedents.length, outgoing.get(step.id).length, 1) - 1) * 10),
    ]));
    let nextY = laneTop;

    for (const lane of lanes) {
      const laneSteps = scheduled
        .filter((step) => step.lane === lane)
        .sort((a, b) => proportional
          ? a.start - b.start || a.index - b.index
          : stages.get(a.id) - stages.get(b.id) || a.index - b.index);
      const rowItems = [];
      const rowEnds = [];
      for (const step of laneSteps) {
        const stage = stages?.get(step.id);
        const x = proportional ? step.start * scale : columnXs[stage] + (columnWidths[stage] - flowWidths.get(step.id)) / 2;
        const width = proportional ? step.duration * scale : flowWidths.get(step.id);
        let row = rowEnds.findIndex(end => end <= x);
        if (row < 0) row = rowEnds.length;
        rowEnds[row] = x + width + (proportional ? 0 : 14);
        if (!rowItems[row]) rowItems[row] = [];
        rowItems[row].push(step);
      }
      const rowHeights = rowItems.map((items) => Math.max(...items.map((step) => cardHeights.get(step.id))));
      const rowGap = 12;
      const contentHeight = rowHeights.reduce((total, height) => total + height, 0) + Math.max(0, rowHeights.length - 1) * rowGap;
      const height = Math.max(72, contentHeight + 22);
      let rowTop = nextY + (height - contentHeight) / 2;
      rowItems.forEach((items, row) => {
        const rowHeight = rowHeights[row];
        for (const step of items) {
          const startInset = proportional ? boundaryInset(step.start, step.duration) : 0;
          const endInset = proportional ? boundaryInset(step.end, step.duration) : 0;
          const stage = stages?.get(step.id);
          const x = proportional
            ? left + step.start * scale + startInset
            : columnXs[stage] + (columnWidths[stage] - flowWidths.get(step.id)) / 2;
          const width = proportional ? step.duration * scale - startInset - endInset : flowWidths.get(step.id);
          const cardHeight = cardHeights.get(step.id);
          cardPositions.set(step.id, {
            x,
            y: rowTop + (rowHeight - cardHeight) / 2,
            width,
            height: cardHeight,
            row,
          });
        }
        rowTop += rowHeight + rowGap;
      });
      laneRows.set(lane, { top: nextY, height });
      nextY += height;
    }

    const defs = svgElement("defs");
    timeline.append(defs);
    const axis = svgElement("g");
    axis.append(svgElement("text", { x: 18, y: 22, class: "axis-label" }, "COMPONENT"));
    axis.append(svgElement("text", { x: left, y: 22, class: "axis-label" }, proportional ? "TIME (s) →" : "DEPENDENCY FLOW →"));
    axis.append(svgElement("line", { x1: left, y1: axisHeight, x2: chartRight, y2: axisHeight, class: "axis-rule" }));
    if (proportional) {
      const tickStep = chooseTickStep(scale);
      for (let time = 0; time <= maxTime; time += tickStep) {
        const x = left + time * scale;
        axis.append(svgElement("line", { x1: x, y1: axisHeight, x2: x, y2: nextY, class: "tick-line" }));
        axis.append(svgElement("text", { x, y: 34, class: "tick-label", "text-anchor": "middle" }, formatNumber(time)));
      }
      if (maxTime === 0 || maxTime % tickStep !== 0) {
        const x = left + maxTime * scale;
        axis.append(svgElement("text", { x, y: 34, class: "tick-label", "text-anchor": "middle" }, formatNumber(maxTime)));
      }
    } else {
      columnXs.forEach((x, stage) => axis.append(svgElement("text", {
        x: x + columnWidths[stage] / 2, y: 34, class: "tick-label", "text-anchor": "middle",
      }, `Stage ${stage + 1}`)));
    }

    lanes.forEach((lane, index) => {
      const { top, height } = laneRows.get(lane);
      timeline.append(svgElement("rect", {
        x: 0, y: top, width: chartRight, height, class: `lane-band${index % 2 ? " alternate" : ""}`,
      }));
      timeline.append(svgElement("line", { x1: 0, y1: top + height, x2: chartRight, y2: top + height, class: "lane-rule" }));
      const laneText = svgElement("text", { x: 18, y: top + 27, class: "lane-name" }, lane);
      laneText.append(svgElement("title", {}, lane));
      timeline.append(laneText);
    });

    timeline.append(axis);

    const byId = new Map(scheduled.map(step => [step.id, step]));
    const visibleSources = new Map(scheduled.map(step => [step.id, []]));
    const visibleTargets = new Map(scheduled.map(step => [step.id, []]));
    for (const target of scheduled) {
      for (const sourceId of target.precedents) {
        const source = byId.get(sourceId);
        if (proportional && !shouldDrawDependency(source, target) && cardPositions.get(sourceId).row === cardPositions.get(target.id).row) continue;
        visibleSources.get(target.id).push(sourceId);
        visibleTargets.get(sourceId).push(target.id);
      }
    }
    // Allocate ports only to rendered edges, ordered by the other card's position.
    const comparePosition = (a, b) => {
      const pa = cardPositions.get(a), pb = cardPositions.get(b);
      return (pa.y + pa.height / 2) - (pb.y + pb.height / 2) || pa.x - pb.x || byId.get(a).index - byId.get(b).index;
    };
    for (const ids of [...visibleSources.values(), ...visibleTargets.values()]) ids.sort(comparePosition);
    const endpointPorts = [];
    const backgroundEdges = svgElement("g", { class: "dependency-background" });
    const foregroundEdges = svgElement("g", { class: "dependency-foreground" });
    const occupied = [];
    timeline.append(backgroundEdges);
    for (const targetStep of scheduled) {
      const targetPosition = cardPositions.get(targetStep.id);
      const sources = visibleSources.get(targetStep.id);
      sources.forEach((sourceId, targetIndex) => {
        const sourceStep = byId.get(sourceId);
        const sourcePosition = cardPositions.get(sourceId);
        const sourceTargets = visibleTargets.get(sourceId);
        const sourceIndex = sourceTargets.indexOf(targetStep.id);
        const startX = sourcePosition.x + sourcePosition.width;
        const startY = sourcePosition.y + spreadPort(sourceIndex, sourceTargets.length, sourcePosition.height);
        const endX = targetPosition.x;
        const endY = targetPosition.y + spreadPort(targetIndex, sources.length, targetPosition.height);
        const offset = Math.min(1, (endX - startX) / 3);
        const obstacles = [...cardPositions.values()];
        const fractions = [];
        if (sourceTargets.length > 1) fractions.push(sourceIndex / (sourceTargets.length - 1));
        if (sources.length > 1) fractions.push(targetIndex / (sources.length - 1));
        const rank = fractions.length ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : 0.5;
        // Nest fan-out and fan-in tracks in endpoint order to reduce crossings.
        const preferredFraction = endY >= startY ? 1 - rank : rank;
        const routed = routeDependency({x:startX+offset,y:startY}, {x:endX-offset,y:endY}, obstacles,
          { occupied, preferredFraction, trackCount: Math.max(sourceTargets.length, sources.length) });
        const points = [{x:startX,y:startY}, ...routed, {x:endX,y:endY}];
        occupied.push(...routeSegments(points));
        const pathData = roundedRoute(points);
        const port = {
          sourceStep,
          targetStep,
          startX,
          startY,
          endX,
          endY,
          pathData,
        };
        const edge = svgElement("g", { class: "dependency-edge" });
        const visibleLine = svgElement("path", { d: port.pathData, class: "dependency-line" });
        visibleLine.append(svgElement("title", {}, `Precedent: ${sourceStep.label} (${sourceStep.id})`));
        edge.append(visibleLine);
        const hitArea = svgElement("path", {
          d: port.pathData,
          class: "dependency-hit-area",
          "aria-hidden": "true",
        });
        hitArea.append(svgElement("title", {}, `Precedent: ${sourceStep.label} (${sourceStep.id})`));
        edge.append(hitArea);
        bindEdgeHighlight(edge, edge);
        backgroundEdges.append(edge);
        const foregroundLine = svgElement("path", { d: port.pathData, class: "dependency-foreground-line" });
        foregroundEdges.append(foregroundLine);
        edge.foregroundLine = foregroundLine;
        port.edge = edge;
        endpointPorts.push(port);
      });
    }

    const laneColors = new Map(lanes.map((lane, index) => [lane, COLORS[index % COLORS.length]]));
    for (const step of scheduled) {
      const position = cardPositions.get(step.id);
      const [fill, stroke] = laneColors.get(step.lane);
      const group = svgElement("g");
      group.append(svgElement("title", {}, proportional
        ? `${step.label} (${step.id}) · ${formatNumber(step.start)}–${formatNumber(step.end)} s · duration ${formatNumber(step.duration)} seconds`
        : `${step.label} (${step.id}) · ${step.lane}`));
      const clipId = `card-label-${step.index}`;
      const clip = svgElement("clipPath", {id: clipId});
      clip.append(svgElement("rect", {x: position.x + 6, y: position.y, width: Math.max(0,position.width-12), height: position.height}));
      defs.append(clip);
      const rect = svgElement("rect", {
        x: position.x, y: position.y, width: position.width, height: position.height,
        rx: 5, fill, stroke, class: "step-card",
      });
      rect.append(svgElement("title", {}, proportional
        ? `${step.label} (${step.id}) · ${formatNumber(step.duration)} seconds`
        : `${step.label} (${step.id}) · ${step.lane}`));
      group.append(rect);
      const label = svgElement("text", {
        x: position.x + 9,
        y: position.y + position.height / 2 + (position.height > 43 ? -2 : 4),
        class: "step-card-text", "clip-path": `url(#${clipId})`,
      }, proportional ? truncate(step.label, Math.floor(position.width / 7)) : step.label);
      group.append(label);
      if (position.width > 58 && position.height > 43) {
        group.append(svgElement("text", {
          x: position.x + 9, y: position.y + position.height / 2 + 13, class: "step-id-text", "clip-path": `url(#${clipId})`,
        }, proportional ? truncate(step.id, Math.floor((position.width - 18) / 5.5)) : step.id));
      }
      timeline.append(group);
    }

    timeline.append(foregroundEdges);

    for (const port of endpointPorts) {
      const sourcePosition = cardPositions.get(port.sourceStep.id);
      const sourceRadius = Math.min(4, sourcePosition.width / 2, sourcePosition.height / 2);
      const targetPosition = cardPositions.get(port.targetStep.id);
      const targetRadius = Math.min(4.5, targetPosition.width / 2, targetPosition.height / 2);
      const base = endpointPort(port.startX, port.startY, sourceRadius, "source",
        `Next step: ${port.targetStep.label} (${port.targetStep.id})`);
      const tip = endpointPort(port.endX, port.endY, targetRadius, "destination-left",
        `Precedent: ${port.sourceStep.label} (${port.sourceStep.id})`);
      linkEndpoint(base, tip, port.endX, port.endY, port.edge);
      linkEndpoint(tip, base, port.startX, port.startY, port.edge);
      port.edge.endpointPorts = [base, tip];
      timeline.append(base, tip);
    }

    timeline.setAttribute("width", chartRight);
    timeline.setAttribute("height", nextY + 8);
    timeline.setAttribute("viewBox", `0 0 ${chartRight} ${nextY + 8}`);
  }

  function spreadPort(index, count, height) {
    if (count <= 1) return height / 2;
    const inset = Math.min(8, height / (count + 1));
    return inset + (height - 2 * inset) * index / (count - 1);
  }

  function bindEdgeHighlight(element, edge) {
    const setHighlighted = (highlighted) => {
      const method = highlighted ? "add" : "remove";
      edge.classList[method]("is-highlighted");
      edge.foregroundLine?.classList[method]("is-highlighted");
      for (const port of edge.endpointPorts || []) port.classList[method]("is-highlighted");
    };
    element.addEventListener("pointerenter", () => setHighlighted(true));
    element.addEventListener("pointerleave", () => setHighlighted(false));
    element.addEventListener("focusin", () => setHighlighted(true));
    element.addEventListener("focusout", () => setHighlighted(false));
  }

  function jumpToArrowEnd(target, x, y) {
    const scroller = $(".diagram-scroll");
    const maxLeft = scroller.scrollWidth - scroller.clientWidth;
    const maxTop = scroller.scrollHeight - scroller.clientHeight;
    const left = Math.min(maxLeft, Math.max(0, x - scroller.clientWidth / 2));
    const top = Math.min(maxTop, Math.max(0, y - scroller.clientHeight / 2));
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    scroller.scrollTo({ left, top, behavior });
    target.focus({ preventScroll: true });
  }

  function renderRows(scheduled) {
    const body = $("#step-rows");
    body.replaceChildren();
    for (const step of scheduled) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.innerHTML = `<span class="step-name"></span><span class="step-id"></span>`;
      name.querySelector(".step-name").textContent = step.label;
      name.querySelector(".step-id").textContent = step.id;
      const lane = document.createElement("td");
      lane.innerHTML = '<span class="lane-pill"></span>';
      lane.querySelector(".lane-pill").textContent = step.lane;
      const duration = document.createElement("td");
      duration.textContent = formatNumber(step.duration);
      const precedents = document.createElement("td");
      precedents.textContent = step.precedents.length ? step.precedents.join(", ") : "—";
      const actions = document.createElement("td");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "row-action";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", `Edit ${step.label}`);
      edit.addEventListener("click", () => startEdit(step));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-action delete";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete ${step.label}`);
      remove.addEventListener("click", () => deleteStep(step.id));
      actions.append(edit, remove);
      tr.append(name, lane, duration, precedents, actions);
      body.append(tr);
    }
    $("#step-count").textContent = String(scheduled.length);
    $("#empty-table").hidden = scheduled.length > 0;
  }

  function render() {
    const result = normalizeSteps(steps);
    if (result.errors.length) {
      renderRows(steps);
      timeline.replaceChildren();
      $("#empty-diagram").hidden = false;
      $("#total-time").textContent = "";
      setMessage(result.errors.join(" "));
      return;
    }

    const scheduled = result.steps;
    renderRows(scheduled);
    $("#empty-diagram").hidden = scheduled.length > 0;
    $("#total-time").textContent = proportional
      ? `Critical path · ${formatNumber(Math.max(0, ...scheduled.map((step) => step.end)))} seconds`
      : `${scheduled.length} steps · ${Math.max(-1, ...flowStages(scheduled).values()) + 1} stages`;
    renderDiagram(scheduled);
  }

  function chooseTickStep(scale) {
    const minimumStep = 88 / scale;
    const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
    for (const multiplier of [1, 2, 5, 10]) {
      const candidate = multiplier * magnitude;
      if (candidate >= minimumStep) return candidate;
    }
    return 10 * magnitude;
  }

  function setZoom(percent, fit = false) {
    const scroller = $(".diagram-scroll");
    const previousScale = baseScale * zoomPercent / 100;
    const centerOffset = scroller.clientWidth / 2 - 126;
    const focusedTime = Math.max(0, (scroller.scrollLeft + centerOffset) / previousScale);
    const roundedPercent = fit ? Math.floor(percent / 5) * 5 : Math.round(percent / 5) * 5;
    zoomPercent = Math.min(1000, Math.max(5, roundedPercent));
    $("#zoom-level").value = String(zoomPercent);
    $("#zoom-value").textContent = `${zoomPercent}%`;
    render();
    if (fit) {
      scroller.scrollLeft = 0;
    } else {
      scroller.scrollLeft = Math.max(0, focusedTime * baseScale * zoomPercent / 100 - centerOffset);
    }
  }

  function startEdit(step) {
    editingId = step.id;
    fields.id.value = step.id;
    fields.lane.value = step.lane;
    fields.label.value = step.label;
    fields.duration.value = String(step.duration);
    fields.precedents.value = step.precedents.join("; ");
    fields.id.disabled = true;
    $("#form-title").textContent = `Edit ${step.id}`;
    $("#save-step").textContent = "Save changes";
    $("#cancel-edit").hidden = false;
    fields.lane.focus();
  }

  function deleteStep(id) {
    const next = steps.filter((step) => step.id !== id);
    if (validateAndRender(next)) {
      if (editingId === id) clearForm();
    }
  }

  function formatNumber(number) {
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3)));
  }

  function truncate(text, maxLength) {
    if (maxLength < 2) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextStep = stepFromForm();
    const next = editingId
      ? steps.map((step) => step.id === editingId ? nextStep : step)
      : [...steps, nextStep];
    if (validateAndRender(next)) clearForm();
  });

  $("#cancel-edit").addEventListener("click", clearForm);
  $("#clear-steps").addEventListener("click", () => {
    clearForm();
    validateAndRender([]);
  });
  $("#proportional-view").addEventListener("click", () => {
    proportional = true;
    $("#proportional-view").setAttribute("aria-pressed", "true");
    $("#sequence-view").setAttribute("aria-pressed", "false");
    $(".zoom-controls").hidden = false;
    $("#diagram-title").textContent = "Startup timeline";
    $("#timeline").setAttribute("aria-label", "Startup steps arranged by component and time");
    $(".diagram-scroll").setAttribute("aria-label", "Scrollable startup timeline");
    $("#view-description").textContent = "Block widths represent duration. Time runs left to right.";
    $(".diagram-scroll").scrollLeft = 0;
    render();
  });
  $("#sequence-view").addEventListener("click", () => {
    proportional = false;
    $("#proportional-view").setAttribute("aria-pressed", "false");
    $("#sequence-view").setAttribute("aria-pressed", "true");
    $(".zoom-controls").hidden = true;
    $("#diagram-title").textContent = "Startup flow";
    $("#timeline").setAttribute("aria-label", "Startup steps arranged by dependency stage and component");
    $(".diagram-scroll").setAttribute("aria-label", "Scrollable startup flow diagram");
    $("#view-description").textContent = "Boxes follow dependencies. Their position and width do not represent time.";
    $(".diagram-scroll").scrollLeft = 0;
    render();
  });
  $("#zoom-level").addEventListener("input", (event) => setZoom(Number(event.target.value)));
  $("#zoom-in").addEventListener("click", () => setZoom(zoomPercent * 1.2));
  $("#zoom-out").addEventListener("click", () => setZoom(zoomPercent / 1.2));
  $("#fit-timeline").addEventListener("click", () => {
    const result = normalizeSteps(steps);
    if (result.errors.length) return;
    const totalTime = Math.max(0, ...result.steps.map((step) => step.end));
    const trailingSpace = proportional ? 80 : 168;
    const availableWidth = $(".diagram-scroll").clientWidth - 126 - trailingSpace;
    const fitPercent = totalTime > 0 ? availableWidth / (totalTime * baseScale) * 100 : 100;
    setZoom(fitPercent, true);
  });

  $("#csv-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const result = parseCsv(await file.text());
      if (result.errors.length) setMessage(result.errors.join(" "));
      else {
        if (validateAndRender(result.steps)) {
          clearForm();
          setMessage(`Imported ${result.steps.length} step${result.steps.length === 1 ? "" : "s"} from ${file.name}.`);
        }
      }
    } catch (error) {
      setMessage(`Could not read CSV file: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  $("#export-csv").addEventListener("click", () => {
    const result = normalizeSteps(steps);
    if (result.errors.length) {
      setMessage(`Cannot export invalid sequence. ${result.errors.join(" ")}`);
      return;
    }
    const blob = new Blob([toCsv(steps)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "startup-sequence.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("CSV exported.");
  });

  new ResizeObserver(() => renderDiagram(normalizeSteps(steps).steps)).observe($(".diagram-scroll"));
  render();
})(globalThis);
