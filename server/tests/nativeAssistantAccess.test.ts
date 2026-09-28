import assert from "node:assert/strict";
import test from "node:test";
import { isCampusAssistantDestination, shouldHideHarmonyAssistant } from "../src/utils/nativeAssistantAccess";

test("Harmony hides assistant for guests and the restricted account", () => {
  assert.equal(shouldHideHarmonyAssistant("harmony", false, null), true);
  assert.equal(shouldHideHarmonyAssistant("harmony", true, "2020240384"), true);
  assert.equal(shouldHideHarmonyAssistant("harmony", true, " 2020240384 "), true);
  assert.equal(shouldHideHarmonyAssistant("harmony", true, "2020240385"), false);
});

test("the same account keeps assistant access outside Harmony", () => {
  for (const client of ["ios", "android", "desktop", "web", "unknown"]) {
    assert.equal(shouldHideHarmonyAssistant(client, false, "2020240384"), false);
  }
});

test("assistant destinations exclude ordinary site-search routes", () => {
  for (const destination of ["/search", "/search/", "https://cputime.cn/search?q=1", "/%73earch"]) {
    assert.equal(isCampusAssistantDestination(destination), true, destination);
  }
  for (const destination of ["/search/results", "/services", "/searching"]) {
    assert.equal(isCampusAssistantDestination(destination), false, destination);
  }
});
