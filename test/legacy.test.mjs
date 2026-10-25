import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

async function shellFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'asr-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'curl'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  return { ...process.env, PATH: `${dir}:${process.env.PATH}`, SIC_API_KEY: 'test-key' };
}
const invoke = (args, env) => spawnSync('bash', [resolve('scripts/asr.sh'), ...args], { env, encoding: 'utf8' });

test('legacy URL workflow retains bearer auth, defaults, options, and no duration requirement', async t => {
  const env = await shellFixture(t);
  const result = invoke(['transcribe', '--url', 'https://example.com/audio', '--speakers', '--words', '--stream', '--format', 'srt'], env);
  assert.equal(result.status, 0);
  const args = JSON.parse(result.stdout);
  assert.equal(args.includes('https://api.speechischeap.com/v2/jobs/'), true);
  assert.equal(args.includes('Authorization: Bearer test-key'), true);
  const body = JSON.parse(args[args.indexOf('-d') + 1]);
  assert.equal(body.can_stream_output, true); assert.equal(body.can_parse_speakers, true);
  assert.equal(body.can_parse_words, true); assert.equal(body.minimum_confidence, 0.5);
  assert.equal(body.segment_duration, 30); assert.equal(body.input_duration, undefined);
});

test('legacy file and status commands retain their upload and auth headers', async t => {
  const env = await shellFixture(t);
  const file = JSON.parse(invoke(['transcribe', '--file', './audio.wav', '--webhook', 'https://example.com/callback'], env).stdout);
  assert.equal(file.includes('https://upload.speechischeap.com/v2/jobs/'), true);
  assert.equal(file.includes('input_file=@./audio.wav'), true);
  assert.equal(file.includes('webhook_url=https://example.com/callback'), true);
  const status = JSON.parse(invoke(['status', 'job-sic'], env).stdout);
  assert.equal(status.includes('https://api.speechischeap.com/v2/jobs/job-sic'), true);
  assert.equal(status.includes('Authorization: Bearer test-key'), true);
});

test('missing API key never selects wallet spending, even with a wallet module configured', async t => {
  const env = await shellFixture(t);
  delete env.SIC_API_KEY;
  env.SIC_X402_WALLET_MODULE = '/a/wallet/that/must/not/load.mjs';
  const result = invoke(['transcribe', '--url', 'https://example.com/audio'], env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SIC_API_KEY environment variable is not set/);
  assert.equal(result.stderr, '');
});

test('explicit x402 mode reaches its own validation without an API key', async t => {
  const env = await shellFixture(t);
  delete env.SIC_API_KEY;
  const result = invoke(['--x402', 'transcribe', '--stream'], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /asynchronous transcription/);
  assert.equal(result.stdout.includes('SIC_API_KEY'), false);
});
