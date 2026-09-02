import { describe, expect, it } from "vitest";
import {
  afterWatchPoll,
  WATCH_FAILURES_BEFORE_SAYING,
  WATCH_HEALTHY,
} from "./watch";

/**
 * Whether the watch is still hearing back.
 *
 * The watch is the safety feature: it polls every forty-five seconds whether
 * or not the map is looking. When the fetch failed it wrote one line to the
 * log and nothing else. No state left the hook, the settings panel went on
 * saying it was watching, the tray icon stayed blue, and a reader asleep with
 * the watch on had no way of finding out it had stopped working at two in
 * the morning.
 */
const START = Date.parse("2026-09-02T02:00:00.000Z");
const MINUTE = 60_000;

describe("what the watch knows about itself", () => {
  it("says nothing about a single dropped request", () => {
    // A laptop lid, a phone changing cell. Telling somebody their warnings
    // have stopped every time one request fails is an app they switch off.
    let health = WATCH_HEALTHY;
    for (let at = 1; at < WATCH_FAILURES_BEFORE_SAYING; at += 1) {
      const outcome = afterWatchPoll(health, false, START + at * MINUTE);
      expect(outcome.say, `failure ${at}`).toBeNull();
      health = outcome.health;
    }
    expect(health.failing).toBe(WATCH_FAILURES_BEFORE_SAYING - 1);
  });

  it("says so once when it has stopped reaching the service", () => {
    let health = WATCH_HEALTHY;
    let said = 0;
    for (let at = 1; at <= 20; at += 1) {
      const outcome = afterWatchPoll(health, false, START + at * MINUTE);
      if (outcome.say === "failing") said += 1;
      health = outcome.health;
    }
    // Once, not twenty times, and not once every forty-five seconds for the
    // rest of the night.
    expect(said).toBe(1);
    expect(health.failing).toBe(20);
  });

  it("measures how long it has been failing rather than counting polls", () => {
    // A machine asleep for six hours wakes with three failures on the clock
    // and six hours of not watching behind it.
    let health = afterWatchPoll(WATCH_HEALTHY, false, START).health;
    health = afterWatchPoll(health, false, START + 6 * 60 * MINUTE).health;
    expect(health.failingSince).toBe(START);
  });

  it("says when it comes back, and only if it had said it was gone", () => {
    let health = WATCH_HEALTHY;
    for (let at = 1; at <= WATCH_FAILURES_BEFORE_SAYING; at += 1) {
      health = afterWatchPoll(health, false, START + at * MINUTE).health;
    }
    const back = afterWatchPoll(health, true, START + 10 * MINUTE);
    expect(back.say).toBe("recovered");
    expect(back.health).toEqual({
      lastCheckedAt: START + 10 * MINUTE,
      failing: 0,
      failingSince: null,
    });

    // A failure nobody was told about needs no recovery announcement.
    const quiet = afterWatchPoll(
      afterWatchPoll(WATCH_HEALTHY, false, START).health,
      true,
      START + MINUTE,
    );
    expect(quiet.say).toBeNull();
  });

  it("records when a poll last came back", () => {
    const outcome = afterWatchPoll(WATCH_HEALTHY, true, START);
    expect(outcome.health.lastCheckedAt).toBe(START);
    expect(outcome.say).toBeNull();
  });

  it("keeps the last good time through a run of failures", () => {
    // "Last checked" is about the last answer, not the last attempt.
    let health = afterWatchPoll(WATCH_HEALTHY, true, START).health;
    health = afterWatchPoll(health, false, START + MINUTE).health;
    health = afterWatchPoll(health, false, START + 2 * MINUTE).health;
    expect(health.lastCheckedAt).toBe(START);
  });
});
