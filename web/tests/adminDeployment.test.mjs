import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../src/api/admin.ts", import.meta.url), "utf8");
const pane = readFileSync(new URL("../src/views/admin/DeploymentPane.vue", import.meta.url), "utf8");
const route = readFileSync(new URL("../../server/src/routes/admin/index.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../server/src/services/deployment.ts", import.meta.url), "utf8");

test("admin deployment requires and forwards one-time schema expansion approval", () => {
  assert.match(api, /confirmation:\s*"UPDATE_AND_DEPLOY",\s*allowSchemaExpand:\s*true/u);
  assert.match(pane, /向后兼容的扩展迁移/u);
  assert.match(pane, /已审查，授权部署/u);
  assert.match(route, /allowSchemaExpand:\s*z\.literal\(true\)/u);
  assert.match(route, /allowSchemaExpand:\s*req\.body\.allowSchemaExpand/u);
  assert.match(service, /input\.allowSchemaExpand\s*!==\s*true/u);
  assert.match(service, /DEPLOY_ALLOW_SCHEMA_EXPAND:\s*"1"/u);
});
