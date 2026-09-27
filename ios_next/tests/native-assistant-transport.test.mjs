import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Run the production framing implementation, rather than matching Swift source.
test('native SSE decoder preserves frames and rejects truncated/oversized events', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cpu-assistant-'));
  try {
    const binary = join(directory, 'checks');
    execFileSync('xcrun', ['swiftc', 'ios_next/CpuTime/CpuTime/AssistantEventDecoder.swift', 'ios_next/tests/AssistantEventDecoderChecks.swift', '-o', binary]);
    assert.match(execFileSync(binary, { encoding: 'utf8' }), /PASS SSE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('production assistant model handles cancellation, retries, history races and account switches', { skip: process.platform !== 'darwin' }, async () => {
  const { readFile, writeFile } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'cpu-assistant-model-'));
  try {
    const view = await readFile('ios_next/CpuTime/CpuTime/NativeAssistantView.swift', 'utf8');
    const hybrid = await readFile('ios_next/CpuTime/CpuTime/HybridWebView.swift', 'utf8');
    // Compile the exact production model and wire types with an in-memory transport.
    const model = view.slice(view.indexOf('@MainActor'), view.indexOf('/// Native conversation surface'));
    const message = view.slice(view.indexOf('struct NativeAssistantMessage:'));
    const types = hybrid.slice(hybrid.indexOf('struct NativeAssistantAction:'), hybrid.indexOf('/// Authentication reports'));
    const source = join(directory, 'Production.swift');
    await writeFile(source, 'import Foundation\nimport Combine\n' + types + model + message);
    const binary = join(directory, 'checks');
    execFileSync('xcrun', ['swiftc', source, 'ios_next/tests/NativeAssistantModelChecks.swift', '-o', binary]);
    assert.match(execFileSync(binary, { encoding: 'utf8' }), /PASS model/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
