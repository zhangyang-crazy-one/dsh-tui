import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readWorkflow = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

test("CI checks supported Node versions and the packed package", () => {
  const workflow = readWorkflow("ci.yml");

  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /push:\n\s+branches: \[main\]/u);
  assert.match(workflow, /node-version: \["22\.19\.0", "24"\]/u);
  assert.match(workflow, /npm test/u);
  assert.match(workflow, /npm run pack:check/u);
});

test("release publishing uses GitHub OIDC and validates the release tag", () => {
  const workflow = readWorkflow("publish.yml");

  assert.match(workflow, /release:\n\s+types: \[published\]/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /github\.event\.release\.tag_name/u);
  assert.match(workflow, /v\$\{package_version\}/u);
  assert.match(workflow, /github\.event\.release\.prerelease/u);
  assert.match(workflow, /npm publish --access public --tag "\$\{NPM_DIST_TAG\}"/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
});
