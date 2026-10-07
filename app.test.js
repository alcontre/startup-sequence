"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSteps, parseCsv, toCsv, shouldDrawDependency, sampleSteps } = require("./app.js");

test("schedules parallel work at earliest dependency completion", () => {
  const result = normalizeSteps([
    { id: "boot", lane: "CPU 0", label: "Boot", duration: 2, precedents: [] },
    { id: "key", lane: "Security", label: "Exchange", duration: 3, precedents: ["boot"] },
    { id: "files", lane: "Storage", label: "Load files", duration: 4, precedents: ["boot"] },
    { id: "decrypt", lane: "CPU 0", label: "Decrypt", duration: 1, precedents: ["key", "files"] },
  ]);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.steps.map(({ id, start, end }) => [id, start, end]), [
    ["boot", 0, 2],
    ["key", 2, 5],
    ["files", 2, 6],
    ["decrypt", 6, 7],
  ]);
});

test("suppresses arrows for sequential steps in the same swimlane", () => {
  assert.equal(shouldDrawDependency(
    { lane: "CPU 0", end: 4 },
    { lane: "CPU 0", start: 4 },
  ), false);
  assert.equal(shouldDrawDependency(
    { lane: "CPU 0", end: 4 },
    { lane: "CPU 0", start: 5 },
  ), true);
  assert.equal(shouldDrawDependency(
    { lane: "CPU 0", end: 4 },
    { lane: "CPU 1", start: 4 },
  ), true);
});

test("sample sequence contains about 30 steps and spans more than a minute", () => {
  const result = normalizeSteps(sampleSteps);
  assert.deepEqual(result.errors, []);
  assert.equal(result.steps.length, 30);
  assert.ok(Math.max(...result.steps.map((step) => step.end)) > 60);
  assert.ok(new Set(result.steps.map((step) => step.lane)).size >= 6);
});

test("rejects duplicate IDs, missing precedents, invalid durations, and cycles", () => {
  assert.match(normalizeSteps([
    { id: "x", lane: "A", label: "One", duration: 1, precedents: [] },
    { id: "x", lane: "B", label: "Two", duration: 0, precedents: ["missing"] },
  ]).errors.join(" "), /Duplicate step ID/);

  assert.match(normalizeSteps([
    { id: "a", lane: "A", label: "A", duration: 1, precedents: ["b"] },
    { id: "b", lane: "B", label: "B", duration: 1, precedents: ["a"] },
  ]).errors.join(" "), /Dependency cycle detected/);
});

test("round-trips quoted CSV fields and semicolon-separated precedents", () => {
  const steps = [
    { id: "key", lane: "Security", label: "Exchange key", duration: 1, precedents: [] },
    { id: "files", lane: "Storage", label: "Load files", duration: 2, precedents: [] },
    {
      id: "decrypt",
      lane: "CPU 0",
      label: 'Decrypt, "secure" image',
      duration: 1.25,
      precedents: ["key", "files"],
    },
  ];
  const parsed = parseCsv(toCsv(steps));

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.steps.map(({ id, lane, label, duration, precedents }) => ({
    id, lane, label, duration, precedents,
  })), steps);
});

test("reports malformed CSV header and unclosed quoted fields", () => {
  assert.match(parseCsv("id,lane\nx,A").errors.join(" "), /missing required column/);
  assert.match(parseCsv('id,lane,label,duration,precedents\nx,A,"open,1,').errors.join(" "), /unclosed quoted field/);
  assert.match(parseCsv("id,lane,label,duration,precedents\nx,A,Step,1").errors.join(" "), /CSV row 2: expected 5 fields/);
  assert.match(parseCsv("id,id,lane,label,duration,precedents").errors.join(" "), /duplicate column/);
});

test("equal-width rows pack visible cards without overlap at every zoom", () => {
  const { assignRows } = require("./app.js");
  const items = normalizeSteps(sampleSteps).steps;
  for (const scale of [2.6, 52, 130]) {
    for (const lane of new Set(items.map(s => s.lane))) {
      const placed = assignRows(items.filter(s => s.lane === lane), scale, false);
      for (const {step, row} of placed) {
        for (const other of placed.filter(p => p.row === row && p.step.start > step.start)) {
          assert.ok(step.start*scale+148 <= other.step.start*scale);
        }
      }
    }
  }
});

test("routes around intervening cards and handles aligned endpoints", () => {
  const { routeDependency } = require("./app.js");
  const cards = [{x:20,y:20,width:60,height:40}, {x:100,y:10,width:50,height:80}];
  for (const [start,end] of [[{x:10,y:40},{x:180,y:40}], [{x:90,y:0},{x:90,y:110}]]) {
    const route = routeDependency(start,end,cards);
    assert.deepEqual(route[0], start);
    assert.deepEqual(route.at(-1),end);
    for(let i=1;i<route.length;i++) {
      const a=route[i-1],b=route[i];
      assert.ok(a.x===b.x || a.y===b.y);
      for (const c of cards) {
        const intersects = a.x===b.x
          ? a.x>c.x && a.x<c.x+c.width && Math.max(a.y,b.y)>c.y && Math.min(a.y,b.y)<c.y+c.height
          : a.y>c.y && a.y<c.y+c.height && Math.max(a.x,b.x)>c.x && Math.min(a.x,b.x)<c.x+c.width;
        assert.equal(intersects,false);
      }
    }
  }
});

test("rounds bends while preserving the route endpoints", () => {
  const { roundedRoute } = require("./app.js");
  assert.equal(roundedRoute([{x:0,y:0},{x:20,y:0},{x:20,y:20}]),
    "M 0 0 L 17 0 Q 20 0 20 3 L 20 20");
  assert.equal(roundedRoute([{x:0,y:0},{x:1,y:0},{x:1,y:20}]),
    "M 0 0 L 0.5 0 Q 1 0 1 0.5 L 1 20");
});

test("fan-out routes reserve separate forward tracks", () => {
  const { routeDependency } = require("./app.js");
  const occupied = [];
  const trunks = [];
  for (let index = 0; index < 5; index += 1) {
    const route = routeDependency({x:0,y:8+index*10}, {x:8,y:100+index*80}, [], {
      occupied, preferredFraction: 1-index/4,
    });
    const segments = route.slice(1).map((end,i) => ({start:route[i],end}));
    const trunk = segments.filter(s => s.start.x === s.end.x)
      .sort((a,b) => Math.abs(b.end.y-b.start.y)-Math.abs(a.end.y-a.start.y))[0];
    trunks.push(trunk.start.x);
    occupied.push(...segments);
    assert.ok(route.every((point,i) => !i || point.x >= route[i-1].x));
  }
  for (let i=1; i<trunks.length; i++) assert.ok(trunks[i-1]-trunks[i] >= 1, "parallel routes need distinct, ordered tracks");
});

test("renders the complete sample in both modes across zoom levels", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  class Element {
    constructor() {
      this.children=[]; this.attributes={}; this.listeners={}; this.clientWidth=1000; this.clientHeight=500; this.scrollWidth=5000; this.scrollHeight=5000;
      const classes=new Set();
      this.classList={add:name => classes.add(name),remove:name => classes.delete(name),contains:name => classes.has(name)};
    }
    setAttribute(k,v) { this.attributes[k]=String(v); }
    getAttribute(k) { return this.attributes[k]; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children=items; }
    addEventListener(k,fn) { this.listeners[k]=fn; }
    scrollTo(position) { this.lastScroll=position; }
    focus() { this.focused=true; }
    querySelector() { return new Element(); }
  }
  const elements=new Map();
  const document={querySelector(selector) { if(!elements.has(selector)) elements.set(selector,new Element()); return elements.get(selector); }, createElement() {return new Element();}, createElementNS() {return new Element();}};
  vm.runInNewContext(fs.readFileSync(require.resolve("./app.js"),"utf8"), {document, ResizeObserver:class {observe(){}}, window:{matchMedia:() => ({matches:true})}, console});
  for(const mode of ["#proportional-view","#sequence-view"]) {
    elements.get(mode).listeners.click();
    for(const zoom of [5,25,100,250]) {
      elements.get("#zoom-level").listeners.input({target:{value:zoom}});
      const svg=elements.get("#timeline");
      assert.equal(svg.children.filter(c => c.children.some(child => child.attributes.class === "step-card")).length,30);
      assert.ok(Number(svg.attributes.height)>0);
      const descendants=(node) => node.children.flatMap(child => [child, ...descendants(child)]);
      const paths=descendants(svg).filter(c => c.attributes.class === "dependency-line");
      assert.ok(paths.length>0);
      assert.ok(paths.every(p => !/NaN|Infinity/.test(p.attributes.d)));
      if (mode === "#proportional-view") {
        const fanout = paths.filter(p => p.children.some(c => c.textContent.includes("(power-good)")));
        const trunks = fanout.map(path => {
          const commands = path.attributes.d.match(/[MLQ][^MLQ]+/g);
          let previous;
          const segments = [];
          for (const command of commands) {
            const numbers = command.slice(1).trim().split(/\s+/).map(Number);
            const end = {x:numbers.at(-2), y:numbers.at(-1)};
            if (command[0] === "L" && previous && end.x === previous.x) segments.push({x:end.x,length:Math.abs(end.y-previous.y)});
            previous = end;
          }
          return segments.sort((a,b) => b.length-a.length)[0].x;
        }).sort((a,b) => a-b);
        for (let i=1; i<trunks.length; i++) assert.ok(trunks[i]-trunks[i-1] >= (zoom >= 100 ? 1 - 1e-8 : 0.01), `power-step fan-out must remain on separate tracks at ${zoom}%: ${trunks.join(", ")}`);
      }
      const firstCard = svg.children.flatMap(c => c.children).find(c => c.attributes.class === "step-card");
      const firstPorts = paths.filter(p => p.children.some(c => c.textContent.includes("(power-good)")))
        .map(p => Number(p.attributes.d.split(" ")[2])).sort((a,b) => a-b);
      assert.ok(firstPorts.length >= 5);
      const top=Number(firstCard.attributes.y), height=Number(firstCard.attributes.height);
      assert.ok(Math.abs((firstPorts[0]-top) - (top+height-firstPorts.at(-1))) < 1e-8, "visible source ports must have symmetric margins");
      const gap=firstPorts[1]-firstPorts[0];
      for(let i=2;i<firstPorts.length;i++) assert.ok(Math.abs(firstPorts[i]-firstPorts[i-1]-gap)<1e-8, "visible source ports must be evenly spaced");
      for(const path of paths) {
        const commands=[...path.attributes.d.matchAll(/([MLQ])\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?))?/gi)];
        let previousX=-Infinity;
        for(const [,type,x,y,x2,y2] of commands) {
          assert.ok(Number(x) >= previousX - 1e-8, "connector must not move backward in time");
          if(type==="Q") assert.ok(Number(x2) >= Number(x) - 1e-8, "rounded bend must not move backward in time");
          previousX=type==="Q" ? Number(x2) : Number(x);
        }
      }
      const sources=svg.children.filter(c => c.attributes.class === "dependency-source-port");
      const targets=svg.children.filter(c => c.attributes.class === "dependency-destination-port");
      assert.equal(sources.length, paths.length);
      assert.equal(targets.length, paths.length);
      for(const [source,target] of sources.map((source,i) => [source,targets[i]])) {
        assert.match(source.attributes.d,/\bA\b/);
        assert.match(target.attributes.d,/\bA\b/);
        assert.match(source.children[0].textContent,/Next step:/);
        assert.match(target.children[0].textContent,/Precedent:/);
      }
      const source=sources[0], target=targets[0];
      const edge=descendants(svg).find(c => c.attributes.class === "dependency-edge");
      const foreground=descendants(svg).find(c => c.attributes.class === "dependency-foreground-line");
      const foregroundLayer=svg.children.findIndex(c => c.attributes.class === "dependency-foreground");
      const firstCardGroup=svg.children.findIndex(c => c.children.some(child => child.attributes.class === "step-card"));
      const firstPort=svg.children.findIndex(c => c.attributes.class === "dependency-source-port");
      assert.ok(firstCardGroup < foregroundLayer && foregroundLayer < firstPort, "highlighted routes must appear above cards and below ports");
      edge.listeners.pointerenter();
      assert.equal(source.classList.contains("is-highlighted"),true);
      assert.equal(target.classList.contains("is-highlighted"),true);
      assert.equal(foreground.classList.contains("is-highlighted"),true);
      edge.listeners.pointerleave();
      assert.equal(source.classList.contains("is-highlighted"),false);
      assert.equal(target.classList.contains("is-highlighted"),false);
      assert.equal(foreground.classList.contains("is-highlighted"),false);
      source.listeners.pointerenter();
      assert.equal(edge.classList.contains("is-highlighted"),true);
      assert.equal(target.classList.contains("is-highlighted"),true);
      source.listeners.pointerleave();
      source.listeners.click();
      assert.equal(target.focused,true);
      assert.ok(elements.get(".diagram-scroll").lastScroll);
      target.listeners.click();
      assert.equal(source.focused,true);
    }
  }
});
