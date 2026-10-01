import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateSettingsPatch } from "@/server/lib/sync/validate";
import { intervalLabel, relativeTime } from "@/lib/sync-format";

describe("validateSettingsPatch", () => {
  test("accepts sane values and empty patches", () => {
    assert.equal(validateSettingsPatch({}), null);
    assert.equal(validateSettingsPatch({ intervalMinutes: 60, syncWindowDays: 10, pendingExpiryDays: 7, enabled: true }), null);
  });
  test("rejects out-of-range values with a human message", () => {
    assert.match(validateSettingsPatch({ intervalMinutes: 5 })!, /Interval/);
    assert.match(validateSettingsPatch({ intervalMinutes: 1441 })!, /Interval/);
    assert.match(validateSettingsPatch({ syncWindowDays: 2 })!, /window/);
    assert.match(validateSettingsPatch({ pendingExpiryDays: 0 })!, /expiry/);
    assert.match(validateSettingsPatch({ pendingExpiryDays: 31 })!, /expiry/);
  });
});

describe("display helpers", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  test("relativeTime", () => {
    assert.equal(relativeTime(null), "never");
    assert.equal(relativeTime("2026-09-20T11:59:30Z", now), "moments ago");
    assert.equal(relativeTime("2026-09-20T11:30:00Z", now), "30 minutes ago");
    assert.equal(relativeTime("2026-09-20T09:00:00Z", now), "3 hours ago");
    assert.equal(relativeTime("2026-09-18T12:00:00Z", now), "2 days ago");
    assert.equal(relativeTime("2026-09-20T13:00:00Z", now), "in 1 hour");
    assert.equal(relativeTime("garbage", now), "—");
  });
  test("intervalLabel", () => {
    assert.equal(intervalLabel(60), "1 hour");
    assert.equal(intervalLabel(180), "3 hours");
    assert.equal(intervalLabel(1440), "1 day");
    assert.equal(intervalLabel(45), "45 min");
  });
});
