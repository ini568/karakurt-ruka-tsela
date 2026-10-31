import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise the real checker against isolated copies; never corrupt the release.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'karakurt-artifact-'));
try {
  const scripts = path.join(temporary, 'tests/regression/publish');
  await mkdir(scripts, { recursive: true });
  const checker = path.join(scripts, 'artifact.mjs');
  await copyFile(path.join(root, 'tests/regression/publish/artifact.mjs'), checker);
  const artifact = path.join(temporary, 'dist');
  const run = () => {
    const result = spawnSync(process.execPath, [checker], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  await cp(path.join(root, 'dist'), artifact, { recursive: true });
  assert.equal(run().status, 0, 'intact copied release must pass');
  await rm(path.join(artifact, 'src/art/styles.css'));
  let result = run();
  assert.notEqual(result.status, 0, 'missing resource must fail');
  assert.match(result.stderr, /missing required artifact file/);
  await copyFile(path.join(root, 'dist/src/art/styles.css'), path.join(artifact, 'src/art/styles.css'));
  await mkdir(path.join(artifact, 'tests'));
  result = run();
  assert.notEqual(result.status, 0, 'service directory must fail');
  assert.match(result.stderr, /forbidden entry/);
  await rm(path.join(artifact, 'tests'), { recursive: true });
  await writeFile(path.join(artifact, 'src/main.js'), "import './missing-resource.js';\n");
  result = run();
  assert.notEqual(result.status, 0, 'broken local import must fail');
  assert.match(result.stderr, /missing local resource/);
  console.log('REGRESSION OK: publish/artifact-negative (intact control; missing file, service directory, broken import rejected)');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
