import assert from "node:assert/strict";
import test from "node:test";
import { extractDurableFacts, sameFactText } from "./fact-extraction.ts";

test("extracts stable slots for common personal facts", () => {
  assert.deepEqual(extractDurableFacts("I live in Austin."), [
    { slot: "self:residence", text: "I live in Austin" },
  ]);
  assert.deepEqual(extractDurableFacts("I moved to Seattle."), [
    { slot: "self:residence", text: "I moved to Seattle" },
  ]);
  assert.deepEqual(extractDurableFacts("My city is Pune."), [
    { slot: "self:residence", text: "My city is Pune" },
  ]);
});

test("extracts entity and key-value facts", () => {
  assert.deepEqual(
    extractDurableFacts("Project Atlas launch is Friday at 4 PM. Owner: Maya."),
    [
      {
        slot: "entity:project atlas launch",
        text: "Project Atlas launch is Friday at 4 PM",
      },
      { slot: "entity:owner", text: "Owner: Maya" },
    ]
  );
});

test("does not turn questions and requests into durable facts", () => {
  assert.deepEqual(extractDurableFacts("When is the Project Atlas launch?"), []);
  assert.deepEqual(extractDurableFacts("Please show my recent meetings."), []);
});

test("normalizes equivalent fact text", () => {
  assert.equal(sameFactText("My city is Pune.", "my city is pune"), true);
  assert.equal(sameFactText("I live in Austin", "I live in Seattle"), false);
});
