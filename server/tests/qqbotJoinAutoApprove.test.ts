import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJoinRequestAnswer,
  matchJoinAutoApproveKeyword,
  normalizeJoinAutoApproveKeywords,
} from "../src/services/qqbot/joinRequestAutoApprove";

test("extracts only the answer part of a QQ join question comment", () => {
  assert.equal(extractJoinRequestAnswer("问题：你是哪个学院的？\n答案：药学院"), "药学院");
  assert.equal(extractJoinRequestAnswer("问题：请填写答案：学号\n答案：2024 级"), "2024 级");
  assert.equal(extractJoinRequestAnswer("我是新生"), "我是新生");
  assert.equal(extractJoinRequestAnswer(""), "");
});

test("matches keywords ignoring case, width, spaces and punctuation", () => {
  const keywords = ["药学院", "CPU"];
  assert.equal(matchJoinAutoApproveKeyword("问题：学院？\n答案：我是 药 学 院 的", keywords), "药学院");
  assert.equal(matchJoinAutoApproveKeyword("问题：学校？\n答案：ｃｐｕ！", keywords), "CPU");
  assert.equal(matchJoinAutoApproveKeyword("问题：学校？\n答案：南京大学", keywords), null);
});

test("does not approve when only the question contains the keyword", () => {
  assert.equal(matchJoinAutoApproveKeyword("问题：你是药学院的吗？\n答案：不是", ["药学院"]), null);
});

test("tolerates a small typo for longer keywords only", () => {
  assert.equal(matchJoinAutoApproveKeyword("答案：中国药科大学生", ["中国药科大学"]), "中国药科大学");
  assert.equal(matchJoinAutoApproveKeyword("答案：中国药客大学", ["中国药科大学"]), "中国药科大学");
  assert.equal(matchJoinAutoApproveKeyword("答案：中国农业大学", ["中国药科大学"]), null);
  assert.equal(matchJoinAutoApproveKeyword("答案：南大", ["药大"]), null);
});

test("returns null without keywords or answer", () => {
  assert.equal(matchJoinAutoApproveKeyword("答案：药学院", []), null);
  assert.equal(matchJoinAutoApproveKeyword("", ["药学院"]), null);
  assert.equal(matchJoinAutoApproveKeyword("问题：学院？\n答案：", ["药学院"]), null);
});

test("normalizes and de-duplicates configured keywords", () => {
  assert.deepEqual(normalizeJoinAutoApproveKeywords([" 药学院 ", "药 学院", "", "！！", "CPU", "ｃｐｕ"]), ["药学院", "CPU"]);
  assert.deepEqual(normalizeJoinAutoApproveKeywords("not-array"), []);
});
