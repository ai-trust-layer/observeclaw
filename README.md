# ObserveClaw

Agent spend tracking, budget enforcement, per-message model routing, PII redaction proxy, prompt injection blocking, tool policy, anomaly detection, and webhook alerting for OpenClaw.

ObserveClaw is an OpenClaw plugin that monitors how much each agent spends on language model calls, enforces daily and monthly budgets, routes messages to different models based on configurable evaluators, strips PII from messages via an external redaction proxy before they reach any AI model, blocks unsafe or malicious messages using LlamaGuard or any safety classifier, controls which tools each agent can use, detects anomalous spending patterns, and sends alerts to external services when something goes wrong. It runs entirely inside the OpenClaw gateway process with no external dependencies beyond an optional companion server for PII redaction and local classification. Every feature works across all channels — Telegram, Slack, Discord, CLI, webhooks, and any other channel OpenClaw supports — without any channel-specific configuration.

## Installation

### From npm

Run the following two commands on any machine where OpenClaw is installed. The first command downloads and installs the plugin into OpenClaw's plugin directory. The second command enables it in the gateway configuration.

```bash
openclaw plugins install observeclaw
openclaw plugins enable observeclaw
```

After enabling, restart the gateway for the plugin to load.

```bash
openclaw gateway restart
```

### From a local directory

If you have the source code checked out, point the install command at the extension directory instead.

```bash
openclaw plugins install ./extensions/observeclaw/
openclaw plugins enable observeclaw
```

Restart the gateway after enabling.

### Verify installation

After restarting the gateway, check that the plugin is loaded.

```bash
openclaw plugins list
```

You should see ObserveClaw listed with status "loaded". The gateway logs will also show a startup line confirming the plugin is active, displaying the default daily budget and the downgrade model. If routing is enabled, a second line will confirm how many evaluators are active and that the fallback is the OpenClaw default model.

## Configuration

Add an `observeclaw` block to your OpenClaw config file under `plugins`. The minimal configuration requires only `enabled: true`. All other settings have sensible defaults.

```yaml
plugins:
  observeclaw:
    enabled: true
```

With no further configuration, the plugin activates with a one hundred dollar daily budget per agent, model downgrade to Claude Haiku at eighty percent of budget, all five anomaly detectors running with default thresholds, and routing disabled.

### Full configuration reference

```yaml
plugins:
  observeclaw:
    enabled: true
    currency: "USD"                    # Display currency. Cost calculation is always USD internally.

    # --- Budget enforcement ---

    budgets:
      defaults:
        daily: 100                     # Default daily spend limit per agent in USD.
        monthly: 2000                  # Default monthly spend limit per agent in USD.
        warnAt: 0.8                    # Ratio (0 to 1) at which model downgrade begins. Default 0.8 (80%).
      agents:
        sales-agent:
          daily: 20
          monthly: 400
        eng-agent:
          daily: 500
          monthly: 10000
          warnAt: 0.9                  # Engineering agents get downgraded later (90%).
        intern-agent:
          daily: 5
          monthly: 100
          warnAt: 0.5                  # Intern agents get downgraded earlier (50%).

    downgradeModel: "claude-haiku-4-5" # Model to force when agent approaches budget limit.
    downgradeProvider: "anthropic"     # Provider for the downgrade model.
                                       # IMPORTANT: downgradeModel and downgradeProvider must be valid for
                                       # your setup. If your agent uses openai-codex, set both accordingly:
                                       #   downgradeModel: "gpt-5.4-mini"
                                       #   downgradeProvider: "openai-codex"

    # --- Per-message routing ---

    routing:
      enabled: true                    # Enable the routing pipeline. Default: false.
      logRouting: true                 # Log every routing decision to the gateway log.
      evaluators:

        # Block dangerous patterns instantly (regex, ~0ms)
        - name: "exec-injection-blocker"
          type: "regex"
          priority: 100
          enabled: true
          patterns:
            - "\\b(rm\\s+-rf|sudo\\s+|chmod\\s+777)"
            - "\\b(curl\\s+.*\\|\\s*sh|wget\\s+.*\\|\\s*bash)"
            - "ignore\\s+(all\\s+)?previous\\s+instructions"
            - "you\\s+are\\s+now\\s+(a|an)\\s+"
            - "\\[SYSTEM\\]|\\[INST\\]"
          provider: "openai-codex"
          model: "gpt-5.4"
          action: "block"
          blockReply: "Message blocked: detected command injection or prompt manipulation."
          emitEvent: true

        # Block unsafe content via LlamaGuard on Ollama (~200-500ms)
        - name: "llamaguard-safety"
          type: "classifier"
          priority: 95
          enabled: true
          url: "http://localhost:11434/v1/chat/completions"
          classifierModel: "llama-guard3:1b"
          prompt: "{{message}}"
          action: "block"
          blockReply: "Message blocked by safety filter."
          routes:
            unsafe: {}                 # No provider/model needed for block action.
          timeoutMs: 2000
          emitEvent: true

        # Route PII through redaction proxy (~0ms detection, proxy strips before forwarding)
        - name: "pii-proxy"
          type: "regex"
          priority: 90
          enabled: true
          patterns:
            - "\\b\\d{3}-\\d{2}-\\d{4}\\b"               # SSN
            - "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}"   # Email
            - "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b"  # Credit card
          provider: "anthropic"
          model: "claude-sonnet-4-6"
          action: "proxy"
          proxyProvider: "redaction-proxy"    # Provider configured with proxy baseUrl.
          proxyModel: "claude-sonnet-4-6"    # Model to request through the proxy.
          proxyUrl: "http://localhost:8443"   # Proxy server URL. Patterns pushed here on startup.
          redactReplacement: "[PII-REDACTED]"
          emitEvent: true
          webhooks:
            - "https://dlp-siem.internal/ingest"

        # Route complex queries to a powerful model (~7ms local HF inference)
        - name: "complexity-router"
          type: "classifier"
          priority: 50
          enabled: true
          url: "http://localhost:8443/v1/chat/completions"
          classifierModel: "query-complexity"
          prompt: "{{message}}"
          routes:
            simple:
              provider: "openai-codex"
              model: "gpt-5.4"
            complex:
              provider: "anthropic"
              model: "claude-sonnet-4-6"
          timeoutMs: 3000
          emitEvent: false

        # External routing webhook
        - name: "external-router"
          type: "webhook"
          priority: 30
          enabled: false
          url: "https://router.internal/decide"
          headers:
            Authorization: "Bearer secret-token"
          timeoutMs: 2000

    # --- Tool policy ---

    toolPolicy:
      defaults:
        allow: []                      # Empty means all tools allowed.
        deny: []                       # Empty means no tools denied.
      agents:
        intern-agent:
          allow:                       # Only these tools are permitted.
            - search
            - read_file
            - send_message
        support-agent:
          deny:                        # These tools are explicitly forbidden.
            - exec
            - shell
            - bash

    # --- Anomaly detection ---

    anomaly:
      spendSpikeMultiplier: 3          # Alert if hourly spend exceeds Nx the 7-day hourly average.
      idleBurnMinutes: 10              # Alert if agent calls LLM for N minutes with no useful output.
      errorLoopThreshold: 10           # Auto-pause after N consecutive LLM errors.
      tokenInflationMultiplier: 2      # Alert if average input tokens doubled over recent calls.
      checkIntervalSeconds: 30         # How often anomaly detectors run. Default 30.

    # --- Pricing overrides ---

    pricing:
      "custom-provider/my-model":
        input: 5
        output: 20
        cacheRead: 0.5
        cacheWrite: 2.5
      "ollama/*":
        input: 0
        output: 0
        cacheRead: 0
        cacheWrite: 0

    # --- Webhooks ---

    webhooks:
      - url: "https://hooks.slack.com/services/T00/B00/xxx"
        minSeverity: warning           # Receives warning and critical alerts.
      - url: "https://events.pagerduty.com/v2/enqueue"
        minSeverity: critical          # Receives only critical alerts.
        headers:
          Authorization: "Token token=your-pagerduty-key"
        timeoutMs: 3000
```

### Provider configuration for the PII proxy

The `proxyProvider` in the evaluator config must point to a provider configured in your OpenClaw models config with the proxy server's base URL and the real upstream API key. The proxy forwards auth headers from the incoming request, so no API key is needed on the proxy server itself.

```yaml
models:
  providers:
    redaction-proxy:
      baseUrl: "http://localhost:8443"
      apiKey: "sk-ant-your-real-key"   # Real Anthropic key — proxy forwards it.
      api: "anthropic-messages"
      models:
        - id: "claude-sonnet-4-6"
          name: "Claude Sonnet 4.6 (via redaction proxy)"
          reasoning: true
          input: ["text", "image"]
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
          contextWindow: 200000
          maxTokens: 64000
```

## How It Works

### Spend tracking

Every time any agent on this gateway makes a call to a language model, OpenClaw fires the `llm_output` hook with the response's token counts. The plugin intercepts this event, looks up the model's pricing in its built-in pricing table, which covers Anthropic, OpenAI, Google, DeepSeek, Mistral, Meta, and local models like Ollama and LM Studio, and calculates the cost of that specific call by multiplying each token type (input, output, cache read, cache write) by its per-million-token rate.

The calculated cost is accumulated in an in-memory data structure that tracks each agent's total spend today, total spend this month, cost in the current rolling hour, a seven-day history of hourly costs, the number of LLM calls made, and the sizes of recent input token payloads. If the agent's call is associated with a specific session, the plugin also tracks per-session spend breakdowns including the session's total cost, total tokens by type, and call count.

After recording the cost, the plugin logs a line showing the agent's name, the cost of this individual call, the cumulative spend for today, and which provider and model were used. If the model is not in the pricing table and no custom pricing is configured, the plugin logs a warning with the raw token counts so the operator can add a pricing override.

The pricing table can be overridden via configuration. If you are using a custom model or a provider whose pricing differs from the defaults, you add an entry to the pricing config with the provider and model name as the key and the per-million-token costs as the value. Wildcard matching is supported, so you can set all Ollama models to zero cost with a single entry like `"ollama/*"`.

### Budget enforcement

Before every LLM call, OpenClaw fires the `before_model_resolve` hook. The plugin intercepts this and checks the agent's cumulative daily spend against its configured budget. Budget checks run before routing, so they always take priority.

If the agent has spent less than the warning threshold of its daily budget, which defaults to eighty percent, the plugin does nothing and the call proceeds normally with whatever model was originally selected.

If the agent has spent between the warning threshold and one hundred percent of its daily budget, the plugin forces a model downgrade. It returns an override that switches the model to a cheaper alternative, by default Claude Haiku. The agent continues to function, but at lower cost per call. This gives the agent a soft landing rather than a hard stop. The plugin logs a warning and pushes a `budget_warning` alert to the alert store and all configured webhooks.

If the agent has exceeded one hundred percent of its daily budget, the plugin hard-blocks the LLM call entirely. It forces an unknown model override that causes OpenClaw to abort the request before any API call is made. The agent accumulates zero additional cost. The user sees an error message indicating the budget has been exceeded. The plugin pushes a `budget_exceeded` alert with critical severity.

Per-agent budgets override the defaults. You can set a five dollar daily budget for an intern agent, a five hundred dollar budget for an engineering agent, and a twenty dollar budget for a sales agent, all on the same gateway.

### Per-message model routing

When routing is enabled, the plugin evaluates a pipeline of configurable evaluators on every incoming message, after the budget check passes. Each evaluator inspects the prompt and decides whether to claim the message by returning a provider and model pair. If multiple evaluators match, the one with the highest priority number wins. If no evaluator matches, the plugin does not override anything and OpenClaw uses whatever model is configured in the agent's defaults.

All enabled evaluators run in parallel using `Promise.all`, so a slow classifier does not delay a fast regex check. The plugin also implements early exit optimization: if the highest-priority evaluator is a regex and it matches instantly, lower-priority evaluators that would require network calls are skipped entirely before their HTTP requests start. This means a priority-100 regex evaluator that matches an SSN pattern in zero milliseconds will cause a priority-50 classifier that takes two hundred milliseconds to be cancelled, and the total pipeline time is effectively zero rather than two hundred milliseconds.

Every pipeline run produces a structured routing event that records which evaluators ran, which matched, which were skipped, how long each took, what label the classifier returned if applicable, which evaluator won, and the total pipeline duration. This event is available for logging and webhook dispatch.

There are three types of evaluators.

**Regex evaluators** match the prompt against one or more regular expression patterns. They are synchronous and effectively instant. They are best suited for detecting known patterns like social security numbers, email addresses, credit card numbers, or specific keywords. Each regex evaluator specifies a provider and model to route to if any pattern matches. Regex evaluators support three actions: `route` sends the message to the specified provider and model, `block` prevents the message from reaching any AI model, and `proxy` routes the message through an external redaction proxy that strips matched content before forwarding to the real LLM.

**Classifier evaluators** send the prompt to a local or remote language model endpoint, such as Ollama or vLLM, with a classification prompt template. The template uses `{{message}}` as a placeholder that gets replaced with the actual prompt. The classifier model responds with a label like "simple" or "complex", and the evaluator maps that label to a provider and model pair using its routes configuration. If the classifier returns an unrecognized label, the evaluator returns null and does not claim the message. Classifier evaluators support partial label matching, so if the classifier responds with "unsafe\nS1" instead of just "unsafe", the evaluator will still match the "unsafe" route. Classifier evaluators have a configurable timeout that defaults to three seconds. Classifier evaluators support `action: "block"` for safety filtering: when configured with block action and a route matches, the message is blocked entirely. Routes for block-only classifiers do not require provider or model fields.

**Webhook evaluators** send the prompt and agent ID as a JSON POST request to an external URL and expect a JSON response containing a provider and model field. If the response contains both fields, the evaluator claims the message with that routing decision. If the response does not contain both fields, the evaluator returns null. Webhook evaluators support custom headers for authentication and a configurable timeout that defaults to two seconds.

### PII redaction via proxy

The `proxy` action solves the problem of PII reaching language models. OpenClaw's hook system cannot modify user message content before it reaches the LLM, so in-place redaction is not possible. Instead, the plugin routes PII-containing messages through an external redaction proxy server that intercepts the API call, strips sensitive data from the message content, and forwards the cleaned request to the real LLM provider.

When a regex evaluator with `action: "proxy"` matches PII patterns in the prompt, it returns a routing decision that points to the proxy provider instead of the evaluator's default provider. The proxy provider is configured in OpenClaw's models config with a `baseUrl` pointing to the redaction proxy server and the real upstream API key. The gateway sends the request to the proxy with the real auth headers. The proxy strips PII from user messages, forwards the cleaned request to the upstream provider, and streams the response back.

The plugin pushes PII patterns to the proxy server dynamically on gateway startup via `POST /config/patterns`. The proxy starts with zero hardcoded patterns. When the gateway boots, the plugin reads the regex patterns from each proxy evaluator's config and sends them to the proxy URL specified in the `proxyUrl` field. This means all pattern management happens in the plugin config. Updating patterns requires only a config change and a gateway restart.

The proxy server forwards auth headers from the incoming request, including `x-api-key`, `authorization`, `anthropic-version`, and `anthropic-beta`. No API key or secret needs to be stored on the proxy server itself. The real key is configured in the proxy provider's OpenClaw config and sent by the gateway as part of the normal request flow.

Redaction entries are still collected by the plugin for audit logging even when using the proxy action. The plugin logs how many PII matches were detected and that the message is being routed through the proxy, providing an audit trail without performing the redaction itself.

### Prompt injection and safety blocking

Prompt injection detection uses a two-layer approach. The first layer is a high-priority regex evaluator that catches known injection patterns instantly, such as "ignore previous instructions", "[SYSTEM]", "[INST]", and shell command patterns. This layer runs in zero milliseconds and blocks obvious attacks before any network call is made.

The second layer is a classifier evaluator running a safety model like LlamaGuard via Ollama. LlamaGuard responds with "safe" or "unsafe\nS1,S2" where S1 and S2 are violated safety categories. The classifier evaluator with `action: "block"` maps the "unsafe" label to a block decision. Safe messages pass through without any routing override.

Because all evaluators run in parallel with early exit, the regex layer at priority 100 catches and blocks obvious injections before the LlamaGuard classifier at priority 95 even starts its network call. For sophisticated attacks that bypass simple regex patterns, LlamaGuard provides the second line of defense. The total latency for a blocked obvious injection is zero milliseconds. The total latency for a blocked sophisticated attack is the LlamaGuard inference time, typically two hundred to five hundred milliseconds on CPU.

Any OpenAI-compatible safety endpoint works as a classifier evaluator. LlamaGuard via Ollama is one option. You can also use a custom safety model hosted on vLLM, a remote moderation API, or any service that returns a label in the standard chat completions response format. The plugin does not hardcode any model names or safety service URLs.

### Message blocking

Any evaluator can be configured with `action: "block"` to block messages entirely instead of routing them. When a blocking evaluator matches, the message never reaches any language model. The plugin forces an unknown model override that causes OpenClaw to abort the call before any API request is made. The agent accumulates zero cost for the blocked message. The user sees an error message that includes the configured `blockReply` text.

Blocking takes priority over routing. If a regex evaluator at priority 30 has `action: "block"` and a classifier at priority 50 also matches, the message is still blocked because blocking is checked across all matched evaluators, not just the winner. This means you can have a low-priority PII blocker that always blocks sensitive data regardless of what the higher-priority routing evaluators decide.

This is critical for data loss prevention. If an agent receives a message containing a social security number, credit card number, or email address, the blocking evaluator prevents that data from ever leaving the machine. The language model never sees it, so there is no risk of the model memorizing, repeating, or exfiltrating the sensitive data.

### Per-evaluator webhook routing

Each evaluator can have its own list of webhook URLs, separate from the global webhook configuration. When an evaluator matches, its per-evaluator webhooks receive the full routing event payload. This allows you to route different types of events to different systems. For example, you can send PII detection events to your security information and event management system while sending cost routing events to your financial operations dashboard, without either system receiving events it does not care about.

Per-evaluator webhooks fire regardless of the `emitEvent` setting. The `emitEvent` flag controls whether the event is also broadcast to the global webhook list and stored in the alert store. An evaluator with `emitEvent: false` and a `webhooks` list will send events only to its own webhooks and not to the global ones.

### Tool policy enforcement

Before every tool call, including both native OpenClaw tools and MCP tools from external servers, OpenClaw fires the `before_tool_call` hook. The plugin checks the tool name against the agent's configured tool policy.

The tool policy supports two modes. In deny-list mode, you specify which tools are explicitly forbidden. Any tool on the deny list is blocked, and everything else is allowed. In allow-list mode, you specify which tools are explicitly permitted. Any tool not on the allow list is blocked. If both an allow list and a deny list are configured, the deny list takes precedence: a tool that appears on both lists is blocked.

When a tool is blocked, the plugin returns a block response with a reason string. OpenClaw communicates this back to the language model as a tool error, and the model typically adjusts its behavior and tries a different approach.

Tool policies are configured per agent. This means you can give a support agent access to search and read tools only, while giving an engineering agent full access to exec and shell tools. An agent with no tool policy configured inherits the global defaults, which by default allow all tools.

### Anomaly detection

At a configurable interval that defaults to every thirty seconds, the plugin evaluates five rule-based anomaly detectors against every tracked agent.

**Spend spike.** Compares the agent's cost in the current rolling hour against the average hourly cost from its seven-day history. If the current hour's cost exceeds three times the historical average, it fires a warning alert.

**Idle burn.** Checks whether the agent has been making LLM calls but has not produced any useful output for more than ten minutes. The plugin considers both tool calls and successfully sent messages as productive output. If the agent is looping internally and making LLM calls without ever responding or using tools, the idle timer grows and eventually fires.

**Error loop.** Checks whether the agent has accumulated ten or more consecutive LLM errors without any successful call in between. If so, it fires a critical alert and marks the agent for auto-pause. A single successful call resets the counter, so transient errors do not trigger false positives.

**Token inflation.** Compares the average input token count in the first half of the agent's recent calls against the second half. If the input size has doubled, it fires an informational alert. This catches context windows that are growing without compaction.

**Budget warning.** Fires a one-time warning when the agent reaches eighty percent of its daily budget. It does not repeat until the daily counters reset at midnight.

### Alerts and notifications

Every alert generated by the anomaly detectors, the budget enforcer, the tool policy enforcer, and the routing pipeline is stored in an in-memory alert store. The store keeps the last one hundred alerts in a first-in-first-out queue. Each stored alert includes the alert type, agent ID, severity, message, optional action, optional metrics, and a timestamp. Routing events optionally include the full structured routing event with per-evaluator results.

Alerts are accessible through three interfaces.

**Gateway RPC methods.** Any client connected to the gateway via WebSocket can call `observeclaw.spend` to get all agents' spend summaries plus the fifty most recent alerts, `observeclaw.alerts` to get only the alerts, or `observeclaw.agent` with an agent ID to get that specific agent's spend, budget, utilization ratio, and recent alerts.

**HTTP endpoint.** A GET request to `/plugins/observeclaw/alerts` returns the fifty most recent alerts as JSON. This endpoint requires gateway authentication.

**Outbound webhooks.** When an alert is generated, the plugin sends it as a JSON POST request to each configured webhook URL. Each webhook has a minimum severity filter. Webhook dispatch is fire-and-forget: failures are logged but do not block or delay other plugin operations. When the webhook URL contains `hooks.slack.com`, the plugin automatically formats the payload using Slack's Block Kit format.

## ObserveClaw Companion Server

The companion server (`observeclaw-server.py`) provides two services on a single port for the plugin's routing evaluators.

**PII redaction proxy** (`POST /v1/messages`) sits between the gateway and the upstream LLM provider. It receives Anthropic API requests, strips PII from user messages using patterns pushed by the plugin, and forwards the cleaned request upstream. It supports both streaming and non-streaming responses. Auth headers from the incoming request are forwarded as-is, so no API key is stored on the server.

**Local HuggingFace classifier** (`POST /v1/chat/completions`) runs a `SequenceClassification` model locally and returns a label in the OpenAI chat completions response format. The model is configurable via `--classifier-model` or the `CLASSIFIER_MODEL` environment variable. Default: `Shaheer001/Query-Complexity-Classifier` with labels `simple`, `medium`, `complex`.

**Pattern push endpoint** (`POST /config/patterns`) receives PII patterns from the plugin on gateway startup. The server starts with zero hardcoded patterns.

```bash
# Full server (PII proxy + classifier)
python observeclaw-server.py

# PII proxy only (fast startup, no model loading)
python observeclaw-server.py --no-classifier

# Custom classifier model
python observeclaw-server.py --classifier-model your-org/your-model --classifier-labels low,medium,high

# Custom upstream and port
python observeclaw-server.py --upstream https://api.anthropic.com --port 9000
```

For Ollama-based classifiers like LlamaGuard, point the plugin evaluator URL directly at `http://localhost:11434/v1/chat/completions`. The companion server is not needed for Ollama models.

## Alert Types Reference

| Type | Severity | Trigger | Action |
|------|----------|---------|--------|
| `budget_warning` | warning | Agent spend reaches the configured warning threshold (default 80% of daily budget) | Model downgraded to cheaper alternative |
| `budget_exceeded` | critical | Agent spend exceeds 100% of daily budget | LLM call hard-blocked, zero additional cost |
| `spend_spike` | warning | Hourly spend exceeds 3x the seven-day hourly average | Alert only |
| `idle_burn` | warning | Agent calling LLM with no useful output for more than 10 minutes | Alert only |
| `error_loop` | critical | 10 or more consecutive LLM errors | Auto-pause recommended |
| `token_inflation` | info | Average input tokens doubled over recent calls | Alert only |
| `routing_event` | info | A routing evaluator with emitEvent matched | Alert with full routing event payload |
| Tool block | warning | Tool call blocked by allow/deny policy | Tool execution prevented |

## Querying Spend Data

### Via gateway WebSocket RPC

Connect to the gateway's WebSocket API and send a request frame.

```json
{"type": "req", "id": "1", "method": "observeclaw.spend"}
```

Response:

```json
{
  "type": "res", "id": "1", "ok": true,
  "payload": {
    "agents": [
      {"agentId": "sales-agent", "today": 14.23, "thisMonth": 312.47, "callCount": 847}
    ],
    "alerts": [
      {"type": "budget_warning", "agentId": "sales-agent", "severity": "warning", "message": "At 82% of budget", "ts": 1711036800000}
    ]
  }
}
```

For a single agent's detail view:

```json
{"type": "req", "id": "2", "method": "observeclaw.agent", "params": {"agentId": "sales-agent"}}
```

### Via HTTP

```bash
curl -H "Authorization: Bearer YOUR_GATEWAY_TOKEN" \
  https://your-gateway/plugins/observeclaw/alerts
```

## Project Structure

```
extensions/observeclaw/
├── index.ts                  Plugin entry point. Parses config, registers hooks, wires modules together.
├── api.ts                    Public type exports.
├── openclaw.plugin.json      Config schema for OpenClaw's plugin validation.
├── src/
│   ├── types/
│   │   ├── config.ts         Configuration interfaces and defaults.
│   │   ├── events.ts         Alert and routing event types.
│   │   ├── runtime.ts        Agent and session spend tracking types.
│   │   └── plugin.ts         Typed interface for the OpenClaw plugin API.
│   ├── routing/
│   │   ├── types.ts          Evaluator config, routing decision, pipeline result types.
│   │   ├── evaluators.ts     Regex, classifier, and webhook evaluator runners.
│   │   ├── pipeline.ts       Parallel pipeline executor with early exit.
│   │   └── validation.ts     Config validation (duplicate priority detection).
│   ├── hooks/
│   │   ├── model-resolve.ts  Budget enforcement and routing pipeline (before_model_resolve).
│   │   ├── prompt-build.ts   No-op placeholder (user message modification not supported by hook).
│   │   ├── llm-output.ts     Spend tracking (llm_output).
│   │   ├── tool-hooks.ts     Tool policy enforcement and productive activity tracking.
│   │   ├── message-hooks.ts  Outbound message cancellation and productive activity tracking.
│   │   └── lifecycle.ts      Session/gateway lifecycle, PII pattern push to proxy on startup.
│   ├── spend-tracker.ts      In-memory per-agent and per-session spend accumulation.
│   ├── budget-enforcer.ts    Budget threshold checks and downgrade decisions.
│   ├── anomaly.ts            Five rule-based anomaly detectors.
│   ├── tool-policy.ts        Allow/deny list evaluation.
│   ├── pricing.ts            Built-in model pricing table with wildcard and override support.
│   ├── alert-store.ts        In-memory alert ring buffer.
│   └── webhook.ts            Webhook dispatch with Slack Block Kit auto-formatting.
```

## Built-in Model Pricing

The plugin includes pricing for the following models. All prices are per million tokens.

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| claude-opus-4-6 | $5.00 | $25.00 | $0.50 | $6.25 |
| claude-sonnet-4-6 | $3.00 | $15.00 | $0.30 | $3.75 |
| claude-sonnet-4-5 | $3.00 | $15.00 | $0.30 | $3.75 |
| claude-haiku-4-5 | $1.00 | $5.00 | $0.10 | $1.25 |
| gpt-5.2 | $1.75 | $14.00 | $0.875 | $1.75 |
| gpt-5 | $1.25 | $10.00 | $0.625 | $1.25 |
| gpt-5-mini | $0.25 | $2.00 | $0.125 | $0.25 |
| gpt-4.1 | $2.00 | $8.00 | $1.00 | $2.00 |
| gpt-4.1-mini | $0.40 | $1.60 | $0.20 | $0.40 |
| gpt-4.1-nano | $0.05 | $0.20 | $0.025 | $0.05 |
| gpt-4o | $2.50 | $10.00 | $1.25 | $2.50 |
| gpt-4o-mini | $0.15 | $0.60 | $0.075 | $0.15 |
| o3 | $2.00 | $8.00 | $1.00 | $2.00 |
| o4-mini | $1.10 | $4.40 | $0.55 | $1.10 |
| codex-mini | $1.50 | $6.00 | $0.75 | $1.50 |
| gemini-3.1-pro | $2.00 | $12.00 | $0.50 | $2.00 |
| gemini-3.1-flash | $0.50 | $3.00 | $0.125 | $0.50 |
| gemini-3.1-flash-lite | $0.25 | $1.50 | $0.0625 | $0.25 |
| gemini-2.5-pro | $1.00 | $10.00 | $0.25 | $1.00 |
| gemini-2.5-flash | $0.30 | $2.50 | $0.075 | $0.30 |
| deepseek-chat (v3) | $0.28 | $0.42 | $0.028 | $0.28 |
| deepseek-reasoner (r1) | $0.50 | $2.18 | $0.05 | $0.50 |
| mistral-medium-3 | $0.40 | $2.00 | $0.04 | $0.40 |
| llama-4-maverick | $0.27 | $0.85 | $0.027 | $0.27 |
| ollama/* | $0.00 | $0.00 | $0.00 | $0.00 |
| lm-studio/* | $0.00 | $0.00 | $0.00 | $0.00 |

Override or extend this table using the `pricing` configuration field.

## Limitations

The plugin does not persist spend data across gateway restarts. When the gateway stops, all in-memory counters are lost. The final spend summary is logged, but historical data is not saved to disk.

The plugin cannot modify the user's message text before it reaches the language model. OpenClaw's `before_prompt_build` hook can only modify the system prompt, not the user message. The `proxy` action works around this by routing PII-containing messages through an external redaction proxy that strips sensitive data before forwarding to the LLM. The `block` action is the alternative when redaction is not needed: it prevents the message from reaching any model entirely.

The plugin does not hide API keys from agents. Agents still hold their own provider credentials in OpenClaw's auth profiles.

The plugin does not coordinate across multiple gateway instances. Each gateway tracks its own agents independently.

Message blocking and budget hard-block work by forcing an unknown model override in the `before_model_resolve` hook. This causes OpenClaw to abort the LLM call before any API request is made, so zero cost is incurred. The user sees an error message rather than a friendly reply.

## Running Tests

```bash
pnpm test -- extensions/observeclaw/
```

The test suite includes one hundred and eleven tests covering unit tests for pricing, spend tracking, budget enforcement, tool policy, and anomaly detection, scenario simulations that reproduce real-world failures including a runaway cache loop cost blowout, prompt injection tool exfiltration, LLM error loops, context window bloat, multi-agent fleet budgets, and spend spikes, end-to-end tests for the alert store, alert pipeline, webhook dispatch, and Slack formatting, six proxy action tests covering PII detection and routing through the redaction proxy with audit trail collection, five classifier block tests covering LlamaGuard-style safety filtering with safe passthrough and unsafe blocking and partial label matching and early exit optimization, and routing tests covering regex, classifier, and webhook evaluators, priority ordering, disabled evaluators, parallel execution with timing proof, early exit optimization, message blocking, per-evaluator webhooks, structured routing event emission, and prompt envelope stripping.
