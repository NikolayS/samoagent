import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * .samohost.toml release-tag-gate contract.
 *
 * samohost's manifest loader (NikolayS/samohost src/manifest/toml.ts:1141-1166 +
 * app/release-policy.ts) REQUIRES two additional fields whenever
 * `releaseTagPattern` is present, and `samohost app register` FAILS validation
 * without them:
 *
 *   releaseTagFormat  = "date"                     (must be the literal "date")
 *   releaseCiWorkflow = ".github/workflows/ci.yml"  (canonical CI workflow path)
 *
 * Until both are present the manifest cannot be registered, so prod cannot be
 * tag-gated (it keeps auto-deploying `main` -> prod, the wrong-vs-target
 * behavior). This guard keeps the required-field contract from silently
 * regressing: if the file declares `releaseTagPattern`, it MUST also declare
 * both canonical fields with their exact canonical values.
 */

const TOML_PATH = join(import.meta.dir, "..", ".samohost.toml");

describe(".samohost.toml release-tag-gate contract", () => {
  const toml = readFileSync(TOML_PATH, "utf8");

  // A key at the start of a line (optionally indented) — never inside a `#` comment.
  const hasReleaseTagPattern = /^[ \t]*releaseTagPattern[ \t]*=/m.test(toml);

  it("declares releaseTagPattern (the file gates prod on a release tag)", () => {
    // Sanity anchor: this whole contract only matters because the manifest
    // opts into tag-gated prod releases. If this ever flips, the required-field
    // assertions below still hold vacuously, so make the premise explicit.
    expect(hasReleaseTagPattern).toBe(true);
  });

  it("when releaseTagPattern is present, requires releaseTagFormat = \"date\"", () => {
    if (!hasReleaseTagPattern) return; // vacuously satisfied without the pattern
    // Exact canonical value, tolerant of surrounding whitespace / alignment.
    expect(toml).toMatch(/^[ \t]*releaseTagFormat[ \t]*=[ \t]*"date"/m);
  });

  it("when releaseTagPattern is present, requires releaseCiWorkflow = \".github/workflows/ci.yml\"", () => {
    if (!hasReleaseTagPattern) return; // vacuously satisfied without the pattern
    // Exact canonical path, tolerant of surrounding whitespace / alignment.
    expect(toml).toMatch(
      /^[ \t]*releaseCiWorkflow[ \t]*=[ \t]*"\.github\/workflows\/ci\.yml"/m,
    );
  });

  it("still parses as valid TOML", () => {
    // Use Bun's built-in TOML parser when available; otherwise keep the text
    // asserts above as the contract and skip the parse check.
    const parse = (globalThis as { Bun?: { TOML?: { parse?: (s: string) => unknown } } }).Bun?.TOML?.parse;
    if (typeof parse !== "function") return;
    const parsed = parse(toml) as Record<string, unknown>;
    expect(parsed.releaseTagPattern).toBe("v*");
    // Once the two required fields are added, they must parse to canonical values.
    expect(parsed.releaseTagFormat).toBe("date");
    expect(parsed.releaseCiWorkflow).toBe(".github/workflows/ci.yml");
  });
});

/**
 * Deploy-tag grammar contract.
 *
 * samohost only treats a tag as a production deploy candidate when it matches
 * (NikolayS/samohost src/commands/app.ts:1210):
 *
 *   ^v(\d{4})(\d{2})(\d{2})\.([1-9]\d*)$     e.g. v20260904.1
 *
 * Two things in this repo must agree with that grammar, or a release either
 * silently fails to deploy or fires an unwanted npm publish:
 *
 *   1. `.github/workflows/npm-publish.yml` must SKIP releases whose tag is a
 *      deploy tag — a `gh release create v20260904.1` fires `release: published`
 *      and would otherwise npm-publish whatever version package.json holds.
 *   2. `.github/workflows/release.yml` must exist to cut those tags, and must
 *      verify CI is green before creating the release.
 */
const DEPLOY_TAG_RE = /^v(\d{4})(\d{2})(\d{2})\.([1-9]\d*)$/;
const WORKFLOW_DIR = join(import.meta.dir, "..", ".github", "workflows");

describe("deploy-tag grammar (samohost app.ts:1210)", () => {
  it("matches dated deploy tags and rejects npm-style tags", () => {
    expect(DEPLOY_TAG_RE.test("v20260904.1")).toBe(true);
    expect(DEPLOY_TAG_RE.test("v20260904.12")).toBe(true);
    // Old npm tags are ignored by the deploy channel.
    expect(DEPLOY_TAG_RE.test("v0.8.0")).toBe(false);
    expect(DEPLOY_TAG_RE.test("v1.2.3")).toBe(false);
    // N is 1-based with no leading zero; the date part is exactly 8 digits.
    expect(DEPLOY_TAG_RE.test("v20260904.0")).toBe(false);
    expect(DEPLOY_TAG_RE.test("v20260904.01")).toBe(false);
    expect(DEPLOY_TAG_RE.test("v2026094.1")).toBe(false);
    expect(DEPLOY_TAG_RE.test("20260904.1")).toBe(false);
  });

  it("npm-publish.yml guards against publishing on a deploy tag", () => {
    const wf = readFileSync(join(WORKFLOW_DIR, "npm-publish.yml"), "utf8");
    // A guard job whose output gates the publish job.
    expect(wf).toMatch(/^\s{2}guard:/m);
    expect(wf).toMatch(/needs:\s*guard/);
    expect(wf).toMatch(/if:\s*needs\.guard\.outputs\.publish == 'true'/);
    // The shell matcher must be anchored on the dated grammar, not a loose
    // startsWith() that would also swallow a real npm tag like v2.1.0.
    expect(wf).toContain("^v[0-9]{8}\\.[1-9][0-9]*$");
    expect(wf).toContain("github.event.release.tag_name");
  });

  it("release.yml cuts dated tags only after checking CI is green", () => {
    const wf = readFileSync(join(WORKFLOW_DIR, "release.yml"), "utf8");
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/contents:\s*write/);
    expect(wf).toContain("gh release create");
    expect(wf).toContain("--target main");
    // CI-green gate on the SHA being tagged.
    expect(wf).toContain("workflows/ci.yml/runs?head_sha=");
    // The tag it computes must be in the deploy grammar.
    expect(wf).toContain("v${today}.${n}");
  });
});
