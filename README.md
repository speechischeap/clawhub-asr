# Speech is Cheap: ClawHub ASR

Give your agent audio or video from a URL or local file and get a transcript
from [Speech is Cheap](https://speechischeap.com/). Results can be JSON, SRT,
or VTT, with optional speaker labels, word timestamps, and sound labels.
Asynchronous jobs support webhook delivery and status retrieval.

The skill supports Speech is Cheap API keys and explicit x402 purchases with
USDC on Base using your existing wallet and a price ceiling. Public x402
support is prelaunch.

## Install

```sh
clawhub install asr
```

API-key mode requires Bash, curl, and a Speech is Cheap account. Configure
`SIC_API_KEY` in your agent's environment.

Wallet mode also needs Node.js 22 or newer, pnpm, and an existing EVM wallet.
Install its dependencies with `pnpm install --frozen-lockfile` from the
installed skill directory when you choose that mode.

[SKILL.md](SKILL.md) tells your agent how to transcribe, recover a purchase,
retrieve results, and cancel a paid job.
See the [source repository](https://github.com/speechischeap/clawhub-asr)
for maintenance guidance.
