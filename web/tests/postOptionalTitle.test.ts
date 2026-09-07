import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const postView = readFileSync(new URL("../src/views/forum/Post.vue", import.meta.url), "utf8");

test("发布页以可选标题替代说说和帖子选择", () => {
  assert.match(postView, /<el-form-item label="标题（可选）">/u);
  assert.match(postView, /不填写也可以直接发布/u);
  assert.match(postView, /'确认发布内容'/u);
  assert.doesNotMatch(postView, /publish-mode-picker|selectPublishMode|const publishMode/u);
});

test("发布时保留数据库标题并按用户是否填写标题决定展示模式", () => {
  assert.match(postView, /const prepared = currentPreparedTopic\(\);[\s\S]*buildMetadata\(prepared\.postMode\)/u);
  assert.match(postView, /pendingSubmissionTitle\.value = prepared\.title/u);
  assert.match(postView, /_postMode: postMode/u);
  assert.match(postView, /title,[\s\S]*content: form\.content,[\s\S]*metadata/u);
});

test("编辑旧动态时不把内部生成标题暴露给用户", () => {
  assert.match(postView, /form\.title = t\.metadata\?\._postMode === "say" \? "" : t\.title/u);
});
