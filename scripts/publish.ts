#!/usr/bin/env bun
import fs from "fs";
import path from "path";
import os from "os";
import { $ } from "bun";

const dry = process.argv.includes("--dry-run");

async function main() {
  const root = process.cwd();
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  const name = pkg.name || "(unknown)";
  const version = pkg.version || "0.0.0";

  console.log(`🔧 Building ${name}@${version}...`);
  const buildRes = await $`bun run build`;
  if (buildRes.exitCode !== 0) throw new Error("build failed");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name.replace("/", "-")}-`));
  console.log(`📦 Preparing publish directory: ${tmp}`);

  function copyOrFail(rel: string) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) throw new Error(`Required path not found: ${rel}`);
    fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }

  // required distributables
  copyOrFail("dist");
  copyOrFail("native");

  // copy docs if present
  ["README.md", "LICENSE", "CHANGELOG.md"].forEach((f) => {
    const p = path.join(root, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(tmp, f));
  });

  // sanitize package.json for publish (remove dev-only fields & scripts)
  const publishPkg = { ...pkg } as Record<string, any>;
  delete publishPkg.devDependencies;
  delete publishPkg.scripts;
  publishPkg.files = Array.from(new Set([...(publishPkg.files || []), "dist", "native"]));
  if (publishPkg.private) delete publishPkg.private;

  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(publishPkg, null, 2) + "\n");

  console.log("📋 Files staged for publish:");
  const lsRes = await $`ls -1`.cwd(tmp);
  if (lsRes.exitCode === 0) console.log(String(lsRes.stdout || "").trim());

  if (dry) {
    console.log("⚠️ Dry run — skipping npm publish. Use --no-dry-run to actually publish.");
  } else {
    const packOnly = process.argv.includes("--pack-only");

    console.log("➡️ Creating package tarball with `bun pm pack`...");
    const packRes = await $`bun pm pack --quiet`.cwd(tmp);
    if (packRes.exitCode !== 0) {
      console.error(String(packRes.stderr || packRes.stdout || ""));
      throw new Error(`bun pm pack failed (${packRes.exitCode})`);
    }
    console.log("✅ Package tarball created:", packRes.stdout.toString('utf8'));

    const tarballName = String(packRes.stdout || packRes.stderr || "").trim().split(/\r?\n/).pop();
    const tarballPath = path.join(tmp, tarballName || "package.tgz");
    console.log(`📦 Packaged: ${tarballPath}`);

    if (packOnly) {
      console.log("ℹ️ --pack-only provided; skipping publish.");
    } else {
      console.log("➡️ Publishing tarball with bun publish...");
      const publishRes = await $`npm publishbun --access public ${tarballPath}`.cwd(root);
      if (publishRes.exitCode !== 0) {
        console.error(String(publishRes.stderr || publishRes.stdout || ""));
        throw new Error(`bun publish failed (${publishRes.exitCode})`);
      }
      console.log("✅ Publish complete.");
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`🎉 ${name}@${version} ${dry ? "(dry-run)" : "published"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
