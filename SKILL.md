---
name: asr
description: Transcribe media URLs or local audio/video files with Speech is Cheap using an API key or explicitly approved x402 USDC payments.
metadata:
  openclaw:
    requires:
      bins: [bash]
      anyBins: [curl, node]
    envVars:
      - name: SIC_API_KEY
        required: false
        description: Required for API-key commands only.
      - name: SIC_X402_WALLET_MODULE
        required: false
        description: Existing wallet module path for new x402 purchases and cancellation.
      - name: SIC_X402_API_BASE
        required: false
        description: Override the x402 API base for an HTTPS endpoint or local mock.
---

# Speech is Cheap ASR

Transcribe a media URL or local audio/video file. Jobs are asynchronous;
prefer a caller-supplied webhook, or poll at the caller's chosen interval.
The examples use the default `./skills/asr/` installation path.

## API-key mode

Use the caller's configured `SIC_API_KEY` with Bash and curl. Keep the key out
of output. If it is missing, direct the caller to
[Speech is Cheap](https://speechischeap.com/) for setup. Wallet spending
requires the caller's explicit choice of `--x402`.

```sh
./skills/asr/scripts/asr.sh transcribe --url "https://example.com/audio.mp3"
./skills/asr/scripts/asr.sh transcribe --file "./audio.wav" \
  --webhook "https://your-domain.com/transcription"
./skills/asr/scripts/asr.sh status "job-id-here"
```

## Wallet mode

Public x402 support is prelaunch. Use an enabled service or a configured local
mock. This mode needs Node.js 22 or newer and dependencies installed with
`pnpm install --frozen-lockfile` in the skill directory.

Set `SIC_X402_WALLET_MODULE` to the absolute path of the caller's existing
module exporting `signer`, an EVM signer with `address` and `signTypedData`.
Cancellation also needs `signMessage`. Reuse its signing approval and spending
controls. Key custody stays with the caller's wallet. This mode needs no
Speech is Cheap API key or Stripe credentials.

Obtain the caller's duration in seconds, from 6 to 86,400, and an approved
`--max-usd` price ceiling before buying. The helper does not measure media.
It accepts only x402 v2 `exact` with native USDC on Base, `eip155:8453`, and
rejects quotes above the ceiling before signing. The quote freezes options,
the webhook, and the purchased duration allowance.

Choose a new `--state` path outside the repository and installed skill for
each purchase. The helper saves the request and proof before sending payment,
with owner-only permissions. Keep the state, temporary files, and upload
tokens out of logs, attachments, and version control.

```sh
mkdir -p "$HOME/.local/state/asr"
./skills/asr/scripts/asr.sh --x402 transcribe \
  --url "https://example.com/audio.mp3" --duration 200 --max-usd 0.01 \
  --state "$HOME/.local/state/asr/recording-001.json"
./skills/asr/scripts/asr.sh --x402 transcribe \
  --file "./audio.wav" --duration 200 --max-usd 0.01 \
  --state "$HOME/.local/state/asr/recording-002.json" \
  --webhook "https://your-domain.com/transcription"
```

File mode uploads the same file through the one-use continuation after paying
once. Start within 300 seconds of readiness; an accepted transfer can run for
up to one hour. Retries preserve these deadlines and the original file.

## Recovery, status, and cancellation

```sh
./skills/asr/scripts/asr.sh --x402 resume --state "$HOME/.local/state/asr/recording-002.json"
./skills/asr/scripts/asr.sh --x402 status "job-id-here"
./skills/asr/scripts/asr.sh --x402 cancel "job-id-here"
```

Resume accepts no replacement options. An unsigned saved request still needs
the configured signer; an existing proof is replayed unchanged. Keep the state
while settlement or provider submission is pending;
an uncertain reply calls for resume, free status, or operator review. An
existing state path cannot create a second purchase. After a crash, confirm
the PID recorded in `.lock` has stopped before removing only that stale lock.

Wallet-mode status uses free `GET /v2/jobs/:jobId` without a wallet or API key.
Cancellation requires the original paying wallet and an auth-only SIWX
signature. It creates no payment. `requested` is pending; `confirmed` means
cancellation succeeded, with a full refund owed. Completion can finish first.

## Transcription options and results

Both modes support `--speakers` for speaker labels, `--words` for word
timestamps, and `--labels` for sound labels. Use `--language <code>` to select
a language, `--confidence <0..1>` for confidence, and
`--segment-duration <6..30>` for segment length. Defaults are automatic
language detection, confidence 0.5, and 30-second segments.

Omit `--format` for JSON; use `--format srt`, `vtt`, or `webvtt` for subtitles.
`--private` redacts the input URL and removes transcript segments after 12
hours. `--webhook <url>` supplies the caller's callback; this skill hosts none.
API-key mode supports `--stream`. Wallet mode is asynchronous and also accepts
`--split-channel` and `--user-agent <value>`.

A transcript and its refund have separate outcomes. Failure, confirmed
cancellation, and unused upload expiry receive full refunds; shorter successful
input can receive a partial refund. Refunds return to the original payer;
a pending refund is not a completed transfer. Deduplicate x402 webhooks by
`X-SiC-Event-ID`. For duration errors, refund rules, and webhook event formats,
consult the [x402 Jobs guide](https://docs.speechischeap.com/x402/).
