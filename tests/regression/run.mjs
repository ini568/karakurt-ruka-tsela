import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkModel } from './model.mjs';
import { checkInput } from './input.mjs';
import { checkClient } from './client.mjs';
import { checkMechanics } from './mechanics.mjs';

const suites = [checkModel, checkInput, checkClient, checkMechanics];
let failures = 0;
for (const suite of suites) {
  try {
    const checks = suite();
    assert.ok(checks.length > 0, `${suite.name} must execute assertions`);
    for (const description of checks) console.log(`PASS ${description}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${suite.name}`);
    console.error(error);
  }
}
// Final suites are self-contained scripts; isolate their exit codes and run all four
// even when one fails. Keep the legacy checks above unchanged.
for (const filename of ['model.mjs', 'client.mjs', 'art.mjs', 'delivery.mjs']) {
  const suitePath = fileURLToPath(new URL(`./final/${filename}`, import.meta.url));
  const result = spawnSync(process.execPath, [suitePath], { stdio: 'inherit' });
  if (result.error || result.signal || result.status !== 0) {
    failures++;
    console.error(`FAIL final/${filename}`);
    if (result.error) console.error(result.error);
    if (result.signal) console.error(`Terminated by ${result.signal}`);
    else if (result.status !== 0) console.error(`Exit code: ${result.status}`);
  }
}
// Finalize suites (team handoff 2026-10-31), same isolation as the final suites.
for (const filename of ['model.mjs', 'client.mjs']) {
  const suitePath = fileURLToPath(new URL(`./finalize/${filename}`, import.meta.url));
  const result = spawnSync(process.execPath, [suitePath], { stdio: 'inherit' });
  if (result.error || result.signal || result.status !== 0) {
    failures++;
    console.error(`FAIL finalize/${filename}`);
    if (result.error) console.error(result.error);
    if (result.signal) console.error(`Terminated by ${result.signal}`);
    else if (result.status !== 0) console.error(`Exit code: ${result.status}`);
  }
}
// Publication behavior checks use real modules and do not require a prepared dist.
for (const filename of ['input.mjs', 'model.mjs', 'model-negative.mjs', 'missing-aim.mjs']) {
  const suitePath = fileURLToPath(new URL(`./publish/${filename}`, import.meta.url));
  const result = spawnSync(process.execPath, [suitePath], { stdio: 'inherit' });
  if (result.error || result.signal || result.status !== 0) {
    failures++;
    console.error(`FAIL publish/${filename}`);
    if (result.error) console.error(result.error);
    if (result.signal) console.error(`Terminated by ${result.signal}`);
    else if (result.status !== 0) console.error(`Exit code: ${result.status}`);
  }
}
if (failures) process.exitCode = 1;
else console.log('REGRESSION OK');
