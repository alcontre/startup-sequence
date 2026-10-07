"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSteps, parseCsv, toCsv, sampleSteps } = require("./app.js");

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
