import assert from "node:assert/strict";
import { test } from "node:test";
import { UPDATE_PROMPT, updateStatus } from "../src/update-status.ts";

const installed = { phase: "complete", kind: "update", message: "Update installed. Camera is ready." };
const ahead = {
  current: "d6507beb",
  available: false,
  message: "This camera has a development build ahead of the release channel.",
};

test("a new check replaces the result of the last install", () => {
  assert.equal(updateStatus(installed, ahead), ahead.message);
  assert.equal(
    updateStatus({ ...installed, phase: "failed", message: "Update failed." }, ahead),
    ahead.message,
  );
});

test("the last install's result shows until the camera is checked again", () => {
  assert.equal(updateStatus(installed, null), installed.message);
});

test("an install in progress speaks over an earlier check", () => {
  const running = { phase: "running", kind: "update", message: "Installing update. The camera will restart." };
  assert.equal(updateStatus(running, { ...ahead, available: true, message: "An update is ready to install" }), running.message);
});

test("Wi-Fi jobs never fill the update line", () => {
  const wifi = { phase: "complete", kind: "wifi", message: "Connected to Studio Wi-Fi" };
  assert.equal(updateStatus(wifi, null), UPDATE_PROMPT);
  assert.equal(updateStatus(wifi, ahead), ahead.message);
  assert.equal(updateStatus({ phase: "idle", kind: "update", message: "" }, null), UPDATE_PROMPT);
});
