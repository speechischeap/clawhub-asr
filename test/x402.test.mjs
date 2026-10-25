import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodePaymentRequiredHeader, encodePaymentResponseHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import { declareSIWxExtension, parseSIWxHeader, verifySIWxSignature } from '@x402/extensions/sign-in-with-x';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { run, parseArgs } from '../scripts/x402.mjs';

const account = privateKeyToAccount(`0x${'1'.repeat(64)}`); // Unfunded test signer; no RPC.
const API = 'https://api.speechischeap.com/v2/x402/jobs/';
const RESOURCE = `${API}?purchase_id=example-purchase`;
const accepted = { scheme: 'exact', network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '10000',
  payTo: '0x2222222222222222222222222222222222222222', maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2', assetTransferMethod: 'eip3009' } };
const READY = { purchase_id: 'example-purchase', status: 'READY', upload_url: 'https://upload.speechischeap.com/v2/x402/jobs/', upload_token: 'test-token' };
const json = (body, status = 202, headers) => Response.json(body, { status, headers });
const challenge = (choice = accepted, url = RESOURCE) => {
  const body = { x402Version: 2, resource: { url }, accepts: [choice] };
  return Response.json(body, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body) } });
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'asr-x402-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, 'purchase.json') };
}
const create = path => ['transcribe', '--url', 'https://example.com/audio.mp3', '--duration', '200', '--max-usd', '0.01', '--state', path, '--webhook', 'https://example.com/callback'];
function countedSigner() {
  let count = 0;
  return { signer: { ...account, signTypedData: async message => { count++; return account.signTypedData(message); } }, count: () => count };
}
async function verifyPayment(header) {
  const payment = decodePaymentSignatureHeader(header);
  assert.equal(payment.resource.url, RESOURCE);
  assert.equal(payment.accepted.amount, '10000');
  assert.equal(await verifyTypedData({ address: account.address, signature: payment.payload.signature,
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: accepted.asset },
    primaryType: 'TransferWithAuthorization', message: payment.payload.authorization,
    types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] } }), true);
}

test('URL mode signs a standard payload, persists it before sending, and forwards the original request', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(url, API);
    const body = JSON.parse(init.body);
    assert.equal(body.input_duration, 200);
    assert.equal(body.webhook_url, 'https://example.com/callback');
    if (++calls === 1) return challenge();
    const state = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(state.body, init.body);
    assert.equal(state.paymentHeaders['PAYMENT-SIGNATURE'], init.headers['PAYMENT-SIGNATURE']);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await verifyPayment(init.headers['PAYMENT-SIGNATURE']);
    return json({ id: 'job-sic', output: {}, status: 'PENDING', purchase_id: 'example-purchase' });
  };
  assert.equal((await run(create(path), { fetchImpl, signer: signing.signer })).id, 'job-sic');
  assert.equal(signing.count(), 1);
  assert.equal(calls, 2);
});

test('lost paid response resumes with identical proof and options without a signer', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  let proof;
  let body;
  await assert.rejects(run(create(path), { signer: signing.signer, fetchImpl: async (_, init) => {
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    proof = init.headers['PAYMENT-SIGNATURE']; body = init.body;
    throw new Error('Connection lost after provider accepted payment');
  } }));
  const result = await run(['resume', '--state', path], { env: {}, fetchImpl: async (_, init) => {
    assert.equal(init.headers['PAYMENT-SIGNATURE'], proof);
    assert.equal(init.body, body);
    return json({ id: 'same-job-sic', status: 'PENDING', admission_status: 'dispatch_pending' });
  } });
  assert.equal(result.id, 'same-job-sic');
  assert.equal(signing.count(), 1);
  await assert.rejects(run(create(path), { signer: signing.signer, fetchImpl: () => assert.fail('Must not buy again') }), /already exists/);
});

test('an expired or removed unpaid quote reports that no payment was taken', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  await assert.rejects(run(create(path), { signer: signing.signer, fetchImpl: async (_, init) => {
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    throw new Error('Connection lost before the paid request arrived');
  } }));
  for (const status of [410, 404]) {
    await assert.rejects(run(['resume', '--state', path], { env: {},
      fetchImpl: async () => new Response('Payment quote was not found', { status }) }), /no payment was taken/);
  }
  assert.equal(signing.count(), 1);
});

test('a proof declined without payment is discarded, and resume signs a new quote', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  const proofs = [];
  const fetchImpl = async (_, init) => {
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    proofs.push(init.headers['PAYMENT-SIGNATURE']);
    if (proofs.length === 2) return json({ id: 'job-sic', status: 'PENDING' });
    const declined = { x402Version: 2, error: 'insufficient_funds', resource: { url: RESOURCE }, accepts: [accepted] };
    return Response.json(declined, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(declined) } });
  };
  await assert.rejects(run(create(path), { signer: signing.signer, fetchImpl }), /insufficient_funds.*no payment was taken/);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).paymentHeaders, undefined);
  assert.equal((await run(['resume', '--state', path], { signer: signing.signer, fetchImpl })).id, 'job-sic');
  assert.equal(signing.count(), 2);
  assert.notEqual(proofs[0], proofs[1]);
});

test('a declined settlement discards the proof, and resume signs a new quote', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  const proofs = [];
  let quotes = 0;
  const fetchImpl = async (_, init) => {
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge(accepted, `${API}?purchase_id=quote-${++quotes}`);
    proofs.push(init.headers['PAYMENT-SIGNATURE']);
    if (proofs.length === 2) return json({ id: 'job-sic', status: 'PENDING' });
    const settlement = { success: false, errorReason: 'insufficient_funds', transaction: '', network: 'eip155:8453', payer: account.address };
    return Response.json({ purchase_id: 'quote-1', status: 'PENDING', payment_status: 'settlement_unknown' },
      { status: 402, headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader(settlement) } });
  };
  await assert.rejects(run(create(path), { signer: signing.signer, fetchImpl }), /Settlement was declined \(insufficient_funds\); no payment was taken/);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).paymentHeaders, undefined);
  assert.equal((await run(['resume', '--state', path], { signer: signing.signer, fetchImpl })).id, 'job-sic');
  assert.equal(quotes, 2);
  assert.equal(signing.count(), 2);
  assert.equal(decodePaymentSignatureHeader(proofs[1]).resource.url, `${API}?purchase_id=quote-2`);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).purchaseId, 'quote-2');
});

test('pending settlement replays the proof and never reselects a price', async t => {
  const { path } = await fixture(t);
  const signing = countedSigner();
  let calls = 0;
  const fetchImpl = async (_, init) => {
    calls++;
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    return json(calls === 2 ? { purchase_id: 'example-purchase', status: 'PENDING', payment_status: 'stripe_pending' }
      : { id: 'job-sic', status: 'PENDING' });
  };
  assert.equal((await run(create(path), { signer: signing.signer, fetchImpl })).payment_status, 'stripe_pending');
  assert.equal((await run(['resume', '--state', path], { fetchImpl, env: {} })).id, 'job-sic');
  assert.equal(signing.count(), 1);
});

test('file mode pays metadata once, forwards only the file, and recovers the upload with its original token', async t => {
  const { dir, path } = await fixture(t);
  const file = join(dir, 'audio.wav');
  await writeFile(file, 'test media bytes');
  const signing = countedSigner();
  let uploads = 0;
  const fetchImpl = async (url, init) => {
    if (url === API) {
      assert.equal(JSON.parse(init.body).input_type, 'upload');
      assert.equal(JSON.parse(init.body).can_parse_words, true);
      assert.equal(JSON.parse(init.body).webhook_url, 'https://example.com/callback');
      if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
      return json({ purchase_id: 'example-purchase', status: 'READY', upload_url: 'https://upload.speechischeap.com/v2/x402/jobs/',
        upload_token: 'test-one-use-token', admission_expires_at: '2026-09-30T12:05:00.000Z', paid_cents: 1, max_input_duration: 300 });
    }
    uploads++;
    assert.equal(init.headers['X-SiC-Upload-Token'], 'test-one-use-token');
    assert.equal(init.headers['PAYMENT-SIGNATURE'], undefined);
    assert.deepEqual([...init.body.keys()], ['input_file']);
    assert.equal(await init.body.get('input_file').text(), 'test media bytes');
    if (uploads === 1) throw new Error('Response lost after upload');
    return json({ id: 'upload-job-sic', status: 'PENDING' }, 200);
  };
  await assert.rejects(run(['transcribe', '--file', file, '--duration', '200', '--max-usd', '0.01', '--state', path,
    '--words', '--webhook', 'https://example.com/callback'], { signer: signing.signer, fetchImpl }));
  assert.equal((await run(['resume', '--state', path], { fetchImpl, env: {} })).id, 'upload-job-sic');
  assert.equal(signing.count(), 1);
});

test('file mode consumes upload SSE but returns the accepted job only', async t => {
  const { dir, path } = await fixture(t);
  const file = join(dir, 'audio.wav');
  await writeFile(file, 'test media');
  const result = await run(['transcribe', '--file', file, '--duration', '200', '--max-usd', '0.01', '--state', path], {
    signer: account, fetchImpl: async (url, init) => url === API ? (!init.headers['PAYMENT-SIGNATURE'] ? challenge()
      : json({ status: 'READY', upload_url: 'https://upload.speechischeap.com/v2/x402/jobs/', upload_token: 'test-token' }))
      : new Response('data: {"type":"upload","bytes_uploaded":10}\n\ndata: {"id":"sse-job-sic","status":"PENDING"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
  });
  assert.equal(result.id, 'sse-job-sic');
  assert.equal(JSON.stringify(result).includes('test-token'), false);
});

test('changed upload contents never trigger another payment or upload', async t => {
  const { dir, path } = await fixture(t);
  const file = join(dir, 'audio.wav');
  await writeFile(file, 'original');
  await writeFile(path, JSON.stringify({ version: 1, endpoint: API, body: '{}', file, fileHash: 'different',
    paymentHeaders: { 'PAYMENT-SIGNATURE': 'saved-proof' }, response: READY }), { mode: 0o600 });
  await assert.rejects(run(['resume', '--state', path], { env: {}, fetchImpl: async (url, init) => {
    assert.equal(url, API);
    assert.equal(init.headers['PAYMENT-SIGNATURE'], 'saved-proof');
    return json(READY);
  } }), /file changed/);
});

test('a failed or expired upload reports its refunded outcome instead of retrying the dead token', async t => {
  const { dir, path } = await fixture(t);
  const file = join(dir, 'audio.wav');
  await writeFile(file, 'test media');
  const signing = countedSigner();
  const calls = [];
  const failed = { purchase_id: 'example-purchase', status: 'FAILED', output: { error: 'Upload failed' } };
  const fetchImpl = async (url, init) => {
    calls.push(url !== API ? 'upload' : init.headers['PAYMENT-SIGNATURE'] ? 'paid' : 'quote');
    if (url !== API) return json({ error: 'Upload failed', purchase_id: 'example-purchase' }, 410);
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    // The service fails the transfer with a full refund and reports it to replays.
    return json(calls.includes('upload') ? failed : READY);
  };
  assert.deepEqual(await run(['transcribe', '--file', file, '--duration', '200', '--max-usd', '0.01', '--state', path],
    { signer: signing.signer, fetchImpl }), failed);
  assert.deepEqual(await run(['resume', '--state', path], { env: {}, fetchImpl }), failed);
  assert.deepEqual(calls, ['quote', 'paid', 'upload', 'paid', 'paid']);
  assert.equal(signing.count(), 1);

  // A resume after the 300-second start window learns that the unused purchase expired.
  const expired = { purchase_id: 'example-purchase', status: 'EXPIRED', output: { error: 'Paid purchase was not used before its deadline' } };
  const state = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...state, response: READY }));
  assert.deepEqual(await run(['resume', '--state', path], { env: {}, fetchImpl: async url => {
    assert.equal(url, API);
    return json(expired);
  } }), expired);
});

test('file mode replays a pending payment until its upload is ready, for a bounded time', async t => {
  const { dir, path } = await fixture(t);
  const file = join(dir, 'audio.wav');
  await writeFile(file, 'test media');
  const pending = { purchase_id: 'example-purchase', status: 'PENDING', payment_status: 'stripe_pending' };
  const pauses = [];
  let replays = 0;
  const transcribe = (state, fetchImpl) => run(['transcribe', '--file', file, '--duration', '200', '--max-usd', '0.01', '--state', state],
    { signer: account, fetchImpl, pause: async ms => { pauses.push(ms); } });
  const result = await transcribe(path, async (url, init) => {
    if (url !== API) return json({ id: 'upload-job-sic', status: 'PENDING' });
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    return json(++replays < 3 ? pending : READY);
  });
  assert.equal(result.id, 'upload-job-sic');
  assert.deepEqual(pauses, [30_000, 30_000]);

  replays = 0;
  assert.deepEqual(await transcribe(join(dir, 'stuck.json'), async (url, init) => {
    assert.equal(url, API);
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    replays++;
    return json(pending);
  }), pending);
  assert.equal(replays, 21);
});

test('invalid duration, streaming, price ceiling, unsupported asset/network, and rate limits reject before signing', async t => {
  assert.throws(() => parseArgs(['transcribe', '--url', 'https://example.com/audio', '--duration', 'NaN', '--max-usd', '0.01', '--state', 'unused']), /duration/);
  assert.throws(() => parseArgs(['transcribe', '--stream']), /asynchronous/);
  const { dir } = await fixture(t);
  for (const [index, override] of [{ amount: '20000' }, { network: 'eip155:1' }, { asset: '0x3333333333333333333333333333333333333333' }].entries()) {
    const signing = countedSigner();
    await assert.rejects(run(create(join(dir, `invalid-${index}.json`)), { signer: signing.signer,
      fetchImpl: async () => challenge({ ...accepted, ...override }) }));
    assert.equal(signing.count(), 0);
  }
  const limited = countedSigner();
  await assert.rejects(run(create(join(dir, 'limited.json')), { signer: limited.signer,
    fetchImpl: async () => json({ message: 'Too many quote requests' }, 429, { 'Retry-After': '30' }) }), /no payment was signed.*retry after 30 seconds/);
  assert.equal(limited.count(), 0);
  assert.equal(parseArgs(create(join(dir, 'six.json')).map(arg => arg === '200' ? '6' : arg)).body.input_duration, 6);
  assert.equal(parseArgs(create(join(dir, 'day.json')).map(arg => arg === '200' ? '86400' : arg)).body.input_duration, 86400);
});

test('status is an unauthenticated free GET with JSON or subtitle output', async () => {
  assert.equal(await run(['status', 'job-sic'], { env: {}, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.speechischeap.com/v2/jobs/job-sic');
    assert.equal(init.method, 'GET'); assert.equal(init.headers, undefined);
    return new Response('WEBVTT\n', { headers: { 'Content-Type': 'text/vtt' } });
  } }), 'WEBVTT\n');
});

const CANCEL_URL = 'https://api.speechischeap.com/v2/x402/jobs/job-sic';
function cancelChallenge() {
  const extension = declareSIWxExtension({ network: 'eip155:8453', statement: 'Cancel Speech is Cheap transcription job-sic', expirationSeconds: 300 })['sign-in-with-x'];
  extension.info = { ...extension.info, domain: new URL(CANCEL_URL).host, uri: CANCEL_URL,
    resources: ['urn:speechischeap:cancel:job-sic'], nonce: 'cancel12345678', issuedAt: new Date().toISOString() };
  const body = { x402Version: 2, resource: { url: CANCEL_URL }, accepts: [], extensions: { 'sign-in-with-x': extension } };
  return Response.json(body, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body) } });
}

test('cancellation uses a standard payer-wallet SIWX proof, no payment, and reports requested vs confirmed', async () => {
  const url = CANCEL_URL;
  for (const status of ['requested', 'confirmed']) {
    let calls = 0;
    const result = await run(['cancel', 'job-sic'], { signer: account, env: {}, fetchImpl: async (target, init) => {
      assert.equal(target, url); assert.equal(init.method, 'DELETE');
      if (++calls === 1) return cancelChallenge();
      assert.equal(init.headers['PAYMENT-SIGNATURE'], undefined);
      const proof = parseSIWxHeader(init.headers['SIGN-IN-WITH-X']);
      assert.equal(proof.uri, url); assert.equal(proof.chainId, 'eip155:8453');
      assert.equal((await verifySIWxSignature(proof)).payer.toLowerCase(), account.address.toLowerCase());
      return json({ id: 'job-sic', status: status === 'confirmed' ? 'CANCELED' : 'PENDING', cancellation_status: status }, status === 'confirmed' ? 200 : 202);
    } });
    assert.equal(result.cancellation_status, status);
  }
});

test('cancellation failures give cancellation advice, never payment-state advice', async () => {
  for (const [challengeStatus, status, advice] of [[402, 401, /run cancel again/], [402, 403, /wallet that paid/],
    [404, 404, /No paid x402 job/], [503, 503, /Retry cancel later/]]) {
    let calls = 0;
    await assert.rejects(run(['cancel', 'job-sic'], { signer: account, env: {}, fetchImpl: async () =>
      ++calls === 1 && challengeStatus === 402 ? cancelChallenge() : new Response('Cancellation failed', { status }) }),
    error => error.message.startsWith(`Cancellation returned HTTP ${status}.`) && advice.test(error.message) && !/state/.test(error.message));
  }
});

test('an active state lock rejects concurrent selection; broad file permissions reject resume', async t => {
  const { path } = await fixture(t);
  await writeFile(`${path}.lock`, `${process.pid}\n`);
  await assert.rejects(run(create(path), { fetchImpl: () => assert.fail('Must not run concurrently') }), /already in use/);
  await rm(`${path}.lock`);
  await writeFile(path, '{}', { mode: 0o644 });
  await assert.rejects(run(['resume', '--state', path], { fetchImpl: () => assert.fail('Must not use public proof') }), /only by its owner/);
});

test('unsigned saved request resumes with its configured standard signer module', async t => {
  const { dir, path } = await fixture(t);
  const wallet = join(dir, 'wallet.mjs');
  await writeFile(wallet, `import { privateKeyToAccount } from '${import.meta.resolve('viem/accounts')}';\nexport const signer = privateKeyToAccount('0x${'1'.repeat(64)}');\n`);
  await writeFile(path, JSON.stringify({ version: 1, endpoint: API, body: JSON.stringify({ input_url: 'https://example.com/audio.mp3', input_duration: 200 }), maxUsd: '0.01' }), { mode: 0o600 });
  const result = await run(['resume', '--state', path], { env: { SIC_X402_WALLET_MODULE: wallet }, fetchImpl: async (_, init) => {
    if (!init.headers['PAYMENT-SIGNATURE']) return challenge();
    await verifyPayment(init.headers['PAYMENT-SIGNATURE']);
    return json({ id: 'unsigned-recovery-sic', status: 'PENDING' });
  } });
  assert.equal(result.id, 'unsigned-recovery-sic');
});
