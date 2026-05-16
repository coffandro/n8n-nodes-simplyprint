# Changelog

All notable changes to `n8n-nodes-simplyprint` are documented here.

## 0.4.1

Polish + reliability follow-up to 0.4.0. Adds two real self-host fixes (the trigger could silently register a `localhost` URL with SimplyPrint that the SP backend can't reach; the OAuth company id got cached forever after reauth and bricked every subsequent call with `OAuth2 token is not valid for this company`), and brings the package up to the layout expected for n8n's verified-community-node review.

### Trigger: self-host correctness

- **Refuses to register unroutable webhook URLs.** `webhookMethods.create()` now throws a clear `NodeOperationError` if n8n hands it a webhook URL that points at `localhost`, the loopback ranges (`127.0.0.0/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`), `*.local` / `*.localhost`, IPv6 ULA (`fc00::/7`), or `0.0.0.0`. The error message lists the four ways to fix it (`WEBHOOK_URL`, `n8n start --tunnel`, the new override field, or the new toggle below). Previously these URLs were registered silently and SimplyPrint's delivery service had no way to reach them.
- **New "Webhook Options" collection on the trigger node.**
    - **Public Base URL Override** — overrides the host (and optional path prefix) of the URL we register with SimplyPrint. Useful when n8n runs behind NAT / on localhost but is reachable via a tunnel (ngrok, Cloudflare Tunnel) or reverse proxy. Preserves n8n's path so the actual webhook still resolves on receive.
    - **Allow Private URL** — disables the routability guard. Off by default; turn on only if you have a reverse proxy SimplyPrint can reach but the URL still looks private to the guard.
- `checkExists()` uses the same resolved URL as `create()`, so the URL-equality probe still detects drift across redeploys when the override changes.

### Trigger: manual-trigger diagnostics

- **Sample-fetch failure is no longer silent.** When `webhooks/GetSamplePayload` errors, the emitted envelope now includes `_fallback_reason` (the underlying error message) and, where applicable, `_fallback_http_code` (the HTTP status). Previously the user just saw `data: {}` with `source: "fallback"` and no clue why.
- **Envelope contract is now documented up-front in the `trigger()` docstring.** Live deliveries pass SP's raw body through; the manual-trigger path emits a sample envelope where `source` is `"real"`, `"synthetic"`, or `"fallback"`, with the two `_fallback_*` keys only appearing on the `"fallback"` branch.

### OAuth: company id self-heal

- **`simplyprintCall` auto-recovers from stale-company-id errors.** The OAuth credential's resolved company is cached in workflow static data keyed by panel URL. If a user reauthenticates with a token bound to a different org (or the SimplyPrint admin moves them between orgs), the cache hands back the old id and every subsequent call hits `/api/<old>/...` and gets `OAuth2 token is not valid for this company`. The client now detects that exact error (in either the thrown 403 or the `{status: false, message: ...}` envelope), drops the cache entry, re-resolves the company via `account/GetUser`, and retries the original request once. Only kicks in for OAuth credentials when the caller didn't pass an explicit `company` override. One retry only; a second mismatch surfaces normally.

### Verified-community-node readiness

- **Migrated to `@n8n/node-cli` scripts.** `package.json` scripts are now `n8n-node build` / `dev` / `lint` / `release` / `prerelease`; `n8n.strict: true` enabled. The CLI runs the official lint suite, blocks accidental local `npm publish` (you must go through `npm run release`), and in CI mode publishes with provenance.
- **ESLint flat config.** `.eslintrc.js` removed; `eslint.config.mjs` re-exports `@n8n/node-cli/eslint`, which pulls in `@n8n/eslint-plugin-community-nodes` + the legacy `eslint-plugin-n8n-nodes-base` rules with the right overrides. Bumped eslint to v9.
- **Codex metadata corrected.** The `node` field in `SimplyPrint.node.json` / `SimplyPrintTrigger.node.json` now follows the `<packageName>.<nodeName>` convention (was using the built-in `n8n-nodes-base.` prefix). `categories` replaced the invalid `Manufacturing` with the documented enum (`Productivity`, `Utility`).
- **Action node declared as `usableAsTool: true`** so it's pickable from the AI Agent node. Trigger node opts out with a justified `eslint-disable-next-line` (a webhook trigger isn't AI-callable).
- **Dropped `gulpfile.js` and `index.js`.** `n8n-node build` runs tsc directly and copies static assets internally.
- **Cleaner `dist/`.** Removed `incremental: true` and `package.json` from the tsconfig include set so the build no longer ships `dist/package.json` (2 kB) or `dist/tsconfig.tsbuildinfo` (76 kB). Package tarball drops from 68.7 kB → 42.4 kB.
- **Credential icons fixed.** Both credentials now point at `file:../nodes/SimplyPrint/simplyprint.svg`. Verified against n8n's `getIconPath` normalizer in `directory-loader.ts` — `path.join` collapses the `..` cleanly and the served URL stays inside the package directory.
- **Release workflow.** `release.yml` now delegates to `npm run release` (which routes through `n8n-node release`); preserves prerelease → `beta` dist-tag handling via `NPM_CONFIG_TAG`.

### Internal

- Tests grew from 81 → 90 passing: new coverage for the OAuth company self-heal (4 cases), the webhook URL routability guard + override (5 cases).
- `getNodeParameter('webhookOptions', {})` is null-safe so older mock contexts in tests don't trip over the new collection.

## 0.4.0

End-to-end audit pass mirroring the work the Activepieces piece received in 0.5.10. SimplyPrint's `AjaxBaseController` keeps `$_POST` (request body) and `$_GET` (URL query string) strictly separate; they are NOT merged. Endpoints declare which scope each field comes from, and helpers like `RequirePrinter()` / `RequireFilament()` default to `$_GET`. Several actions in 0.3.x had been calling endpoints with the right field names but in the wrong scope, which the backend silently dropped. Other endpoints had the wrong path entirely and were 404-ing. None of these surfaced as obvious errors in the n8n UI: toggles never took effect, and reads returned empty.

### Production panel URL is now the default

`Panel URL` on both the OAuth2 and API-key credentials now defaults to `https://simplyprint.io` (was `https://test.simplyprint.io`, a beta-leftover from the 0.3.5 staff test build). Existing credentials are unaffected; the change only applies to newly created connections.

### Wire-format fixes (POST body → URL query string)

- **Queue > Update Item** (`queue/UpdateItem`): `job` moved to query string. `amount` and `note` stay in body. The 0.3.x body-only shape was failing the `RequireQueueItem` helper.
- **Queue > Move Item** (`queue/MoveItem`): `job`/`to` (body) → `jobs`/`moveTo` (query string). The body shape was silently dropped at validation; field names also changed (plural `jobs`, camelCase `moveTo`).
- **Queue > Remove Item** (`queue/DeleteItem`): `job` moved to query string.
- **Queue > Revive Item** (`queue/ReviveItem`): `job` moved to query string.
- **Queue > Approve Item / Deny Item** (`queue/approval/{ApproveItem,DenyItem}`): `jobs` moved to query string as a comma-separated string. `comment` stays in body. **Deny Item** also gets a new `Request Revision` toggle: backend semantics are `remove:true` deletes the item, `remove:false` keeps it as DENIED so the submitter can revise. Default behaviour matches the previous "deny = drop" assumption.
- **Queue > Empty** (`queue/EmptyQueue`): body fields renamed `group_id` → `group` and `include_done` → `done_items`. The "Include Done" toggle had never had any effect; backend was unconditionally hitting the active-queue path.
- **Filament > Assign** (`filament/Assign`): `pid` and `fid` moved to query string. `RequirePrinter()` / `RequireFilaments()` default to reading from `$_GET`. The action now also surfaces **Nozzle** and **Extruder** fields (both default to 0) so multi-tool printers (IDEX, H2D) and multi-material setups (AMS lanes) can be targeted. Sent on the wire as the new-API body shape `{ filament: { <fid>: { nozzle, extruder } } }`; the legacy body-only shape on this endpoint hardcodes nozzle to 0.
- **Filament > Unassign** (`filament/Unassign`): `fid` moved to query string. The `pid` field is no longer surfaced in the UI; backend resolves the printer from the spool's current assignment, so the user only picks the spool. Saved values from 0.3.x workflows are preserved in the workflow JSON but ignored on execute.
- **Filament > Get** (`filament/GetSpecific`): query param renamed `fid` → `id`. Backend reads `id` (numeric) or `uid` (4-character short id) from `$_GET`; `fid` was silently dropped. Response key is `data` (was reading `filament` first, which works on the legacy GetFilament endpoint but not GetSpecific).
- **Print Job > Create** (`printers/actions/CreateJob`): printer ids moved from query string to POST body as `pid` (CSV). `CreateJob.php` calls `RequirePrinters(self::POST, ...)` and reads the body only.

### Wrong-endpoint fixes

- **Organization > Get Many Print History** was hitting `GET /print_history/Get`. That path **does not exist** (404; there is no `api/API/Endpoints/print_history/` directory). Now uses `POST /jobs/GetPaginatedPrintJobs` with `{page: 1}` in the body. Response key is `data`. Heavier responses can be filtered/paged in the upcoming 0.5.0 expansion.
- **Organization > Get Statistics** switched from `GET account/GetStatistics` to `POST account/GetStatistics` with `{general: true}` in the body. The validator requires `general:true` OR a `start_date`/`end_date` pair (`required_unless:general,true`); the GET-with-no-body shape was failing validation outright. Response envelope key is `statistics`.

### Method/scope changes (coverage)

- **Printer > Get Many / Get One** switched from GET to POST. The GET path caps `page_size` at 25 (panel's hard limit); POST allows 100. Big farms now come back in fewer round-trips.
- **Filament > Get Many** + the filament dropdowns switched to POST with `{compact: true}` in the body. The `compact` flag is read from `$_POST` only; the 0.3.x query param landed in `$_GET` and was silently ignored, returning the heavy panel-shape (filament dict keyed by id) instead of the flat compact list. The `Object.values()` workaround in the dropdown loaders is now unnecessary; both shapes are still tolerated as a defensive fallback.

### Internal

- Webhook signature verification was already using `crypto.timingSafeEqual` against equal-length buffers (no change required).

## 0.3.11

- **Brand name fix (round 2).** Same class of bug as 0.3.10 — the sentence-case lint autofixer had lowercased "AutoPrint" (a SimplyPrint trademark) to "autoprint" on two trigger actions (`Printer autoprint state changed`, `Company autoprint state changed`). Restored with per-line eslint suppressions, same pattern as the Custom API Call fix.

## 0.3.10

- **Brand name fix.** The Custom API Call action was showing as "Call any simply print api endpoint" in the Node Creator. The `node-param-operation-option-action-miscased` lint rule had autofixed "SimplyPrint API" -> "simply print api" in an earlier pass. Restored to "Call any SimplyPrint API endpoint" with an eslint-disable-next-line and a one-line justification (proper nouns preserved).

## 0.3.9

Finishing the Activepieces-parity pass — the three items 0.3.8 deliberately deferred.

- **File > Upload and Queue composite removed.** Chain three atomic steps instead: `File > Upload` -> `Queue > Add Item` -> `Print Job > Create`. Each step's error surface and input shape is now visible in the flow builder rather than hidden behind one black-box op. The upload operation's `fileId` (hex UID) output pipes directly into `Queue > Add Item` via its new "Upload Hash" file source (or just store it as a user file and pipe into "User File" mode).
- **Queue > Add Item parameter surface expanded** to match the backend validator:
  - `File Source` selector: `User File` (UID resourceLocator) vs `Upload Hash` (hex string from `File > Upload`). Sends `filesystem` or `fileId` on the wire respectively.
  - New fields: `Target Printer IDs` / `Target Printer Model IDs` / `Target Printer Group IDs` (each comma-separated int strings, sent as `for_printers` / `for_models` / `for_groups`), and `Tag IDs` (comma-separated ints, sent as an int array `tags`).
  - `Queue Group Name or ID` description updated to reflect that it's required only when the account has queue groups configured.
- **Webhook resource removed.** The single `Trigger Test` operation was debug-only. The `SimplyPrint Trigger` node handles receiving deliveries; there's no flow-builder case for firing a test at a user-configured webhook.
- **Trigger event list expanded from 15 to 64** to match the full `WebhookEvent` enum: jobs (started / paused / resumed / cancelled / done / failed / bed_cleared / objects_skipped), printer state (autoprint / nozzle / material / custom tags / out-of-order / AI state / AI failure / AutoPrint cap), company (autoprint / user signup / user pending), queue (add / delete / empty / move / revive / pending_approval / approved / denied), filament (create / update / delete / assigned / unassigned), balance (charged / refunded / topped_up / adjusted), quota (request_new / request_resolved / adjusted / reset), full maintenance set (job lifecycle, problems, low stock, tasks, schedules, spare parts, stock). Each carries a one-line description noting the wrapper keys the body will carry.

Result: 7 resources (down from 8), 30+ operations (down from 30+ with the composite folded out), 64 trigger events (up from 15).

## 0.3.8

Pulling across the fixes the Activepieces piece learned the hard way.

- **Instant sample data in the editor.** The trigger node now implements `trigger() -> { manualTriggerFunction }` that fetches a real event body from `GET /webhooks/GetSamplePayload?event=<e>&limit=1` when the user clicks "Execute step" / "Listen for test event". The emitted envelope matches what `webhook()` returns on a live delivery (`{ webhook_id, event, timestamp, data, source }`), so in-editor tests see the exact same shape as activated runs. Falls back to a synthetic envelope when the endpoint isn't reachable.
- **Endpoint path corrections.** Most of these were guessed or ported from stale docs and never worked:
  - `queue/GetQueueGroups` → `queue/groups/Get` (response key `list`, not `data`)
  - `files/Get` → `files/GetFiles` (query param `f` not `folder_id`; `-1` = all, `0` = root, `N` = folder id; response key `files`, not `data`)
  - `filament/Get` → `filament/GetFilament` (response key `filament`, a dict keyed by id, not an array — now `Object.values`'d)
  - `queue/RemoveItem` → `queue/DeleteItem`
  - `files/Move` → GET `files/MoveFiles` (was POST) with `files` (comma-separated UID hex strings) + `folder` (int) query params
- **File operations trimmed.** `File > Get` (single) and `File > Delete` removed — no OAuth path exists for either (`files/DeleteFile` has `oauth_disabled=true`; no single-file fetch endpoint accepts OAuth). Use `File > Get Many` with a `search` filter to look a single file up.
- **Response field renames to match entity `getFormattedData()`:**
  - Printer row (from `printers/Get`): printer-level fields live under `.printer` (name, state, group, groupName, online, model). `printer.model` can be an expanded `{id, name, brand, ...}` object — simplify flattens it to a string. All loadOptions/listSearch + the simplify helper rewritten accordingly.
  - Queue item (from `queue/GetItems` and `data.queue_item` on webhooks): canonical names are `filename` (not `file_name`), `group` (not `group_id`), `sort_order` (not `order`), `filesystem_id`, `user_id`, `left`, `printed`, `added`.
  - `queue/GetItems` envelope key is `queue` (not `data`); `queue/approval/GetPendingItems` is `items`; `tags/Get` is `tags` (not `data`).
- **User display.** There is no `name` field on SP's `User::getFormattedData()`; added a `userDisplayName()` helper that concatenates `first_name + last_name`.
- **Queue > Add Item.** File identifier changed from numeric `fileId` → string `filesystem` (hex UID), submitted via the `filesystem` body key per backend validation. The Queue > Add Item file picker is now a `resourceLocator` with a "By UID" mode.
- **Tags empty-state.** Accounts with no custom tags get `{ status:false, message }` from `tags/Get`; swallowed as `[]` in both the dropdown and `Organization > Get Many Tags` rather than surfacing as an exception.
- **OAuth scope.** Dropped `custom_fields.write` — not granted to OAuth tokens today and requesting it fails the consent screen.

Static mocks kept as fallback for scope errors / older SP instances.

### Things deliberately NOT done (flagging for follow-up)

- Splitting `File > Upload and Queue` composite into three actions (Upload, Add to Queue, Start Print). Activepieces did this; the n8n composite works but the split is cleaner UX.
- Dropping `Webhook > Trigger Test` as a user-facing action — arguably debug-only.
- Expanding the trigger event list to the full backend enum (~50 events; we expose 15). Add the rest once the current ones are confirmed in production.

## 0.3.7

- **Bug fix: stop reading response payloads from a non-existent `objects` wrapper.** The SimplyPrint backend spreads `$this->objects` into the top level of the response via `array_merge($resp, $this->objects)` in `AjaxBaseController::respond()` — so `webhooks/Create` actually returns `{ status, message, webhook: { id, ... } }`, and list endpoints return `{ status, message, data: [...] }`, NOT `{ status, objects: { ... } }`. The n8n node was reading `res.objects?.webhook?.id` and `res.objects?.data ?? []` everywhere, which always resolved to `undefined` / `[]`. Consequences now fixed:
  - Trigger `create` returned `false` so n8n never persisted the webhook id; `delete` then couldn't clean up on disable — orphan webhooks on the SP side. Matches the Activepieces integration's parser (`res.webhook?.id`) which already handled this correctly.
  - `checkExists` couldn't confirm existing registrations and always fell through to a re-create.
  - Every loadOptions dropdown (Printer, File, Filament, Queue Item, Queue Group, Tag, Custom Field) returned an empty list.
  - `Printer > Get Many`, `Queue > Get Many`, `Print History`, `Tags` and similar Get Many paths emitted the full envelope instead of the array of records.
  - `File > Upload and Queue` couldn't pick up `created_id` from `queue/AddItem`, so step 3 (start print) fell back to `file_id` instead of `queue_file`.
- `SimplyprintResponse<T>` type rewritten as `{ status, message? } & T` to reflect the actual flat shape.
- Tests updated to mock the correct envelope.

## 0.3.6

- **Bug fix: trigger event names now match the backend `WebhookEvent` enum.** The n8n trigger node was shipping dotted-path event names (`queue.item.added`, `ai_failure.detected`, `maintenance_problem.reported`, ...) that SimplyPrint's `webhooks/Create` endpoint rejected with `events.0: Invalid enum value specified!` — so no webhook ever registered. Seven events renamed to their exact backend backing values: `queue.item.added` → `queue.add_item`, `queue.item.approved` → `queue.item_approved`, `queue.item.denied` → `queue.item_denied`, `queue.item.pending_approval` → `queue.item_pending_approval`, `ai_failure.detected` → `printer.ai_failure_detected`, `maintenance_job.overdue` → `maintenance.job_overdue`, `maintenance_problem.reported` → `maintenance.problem_reported`. Existing test-build workflows that already saved the old values need the event dropdown reselected.
- All 0.3.5 behaviour is carried forward: this is still the 0.4.0 work published on the `latest` tag pointing at `https://test.simplyprint.io`.

## 0.3.5

- **Staff test build on the `latest` tag.** Same code as the 0.4.0 work (see below) but published as 0.3.5 so the n8n UI's "Install a community node" flow offers it without requiring the `@beta` selector. Default `panelUrl` in both credentials points at `https://test.simplyprint.io` for end-to-end validation. Production users should pin to 0.3.4 or override `panelUrl` on the credential until the real 0.4.0 ships with the prod URL restored.

## 0.4.0 (staged, not yet published)

### Breaking changes

- **File > Upload now targets `files.simplyprint.io` (the integration-reachable upload API).** `POST /files/Upload` on `api.simplyprint.io` rejects API-key and OAuth requests (`$can_upload = isAppRequest() || isPanelRequest()` in `Upload.php`) — it is reserved for the web panel and mobile-app clients. This release switches the multipart upload to the dedicated `https://files.simplyprint.io/{company}/files/Upload` service, which returns a hex bucket-hash file id. The return shape of `File > Upload` changes: `fileId` is now a **string hash** rather than a numeric id. Requires the Print Farm plan on the account.
- **Category / sub-category enums are now lowercase strings.** The backend `CustomFieldsSubmitController` only accepts lowercase values (`print`, `printer`, `filament`, `user_file`, `user` for category; `print_queue`, `print_job`, `user_file` for sub-category). Previous releases posted uppercase enum names and would fail validation.
- **Operation renames.** All `List` operations have been renamed to `Get Many` (per n8n vocabulary). The underlying `value` has changed from `list` / `listItems` / `listGroups` / etc. to `getAll`. Expression references to the old operation values must be updated.
- **Single-entity selects are now Resource Locators.** The `printerId`, `fileId`, `filamentId`, and `queueItemId` parameters now use the `resourceLocator` component with `list` and `id` modes. Existing workflows keep working because the default mode is `list`, but workflows that assigned a raw numeric value via expression may need to wrap it as `{ __rl: true, mode: 'id', value: N }`.

### Migration from 0.3.x

1. **File > Upload consumers**: if a downstream node consumed the numeric `fileId` returned by the old upload operation, update it to handle a hex string. `File > Upload and Queue` and `Print Job > Create` handle the new id transparently.
2. **Operation value refs**: search workflows for `"operation": "list"` / `"listItems"` / `"listGroups"` and replace with `"getAll"`.
3. **OAuth2 Print Farm plan**: the `files.simplyprint.io` host is only enabled for accounts on the Print Farm plan. Accounts on Hobby / Maker tiers should stay on 0.3.x until they upgrade.

### New features

- **Print Job resource with Create operation.** Wraps `printers/actions/CreateJob` so a workflow can start a print on one or more printers without dropping to Custom API Call. Supports user-file or queue-item sources, shared PRINT_JOB custom fields, per-printer overrides, start options, and MMS slot mappings.
- **File > Upload and Queue composite.** One operation uploads the binary, queues it, and optionally starts a print on a CSV list of printer IDs using `queue_file`. Supports both PRINT_QUEUE custom fields (on the queue item) and PRINT_JOB custom fields (on the started job).
- **Custom fields on Upload and Add to Queue.** Queue items can carry PRINT_QUEUE custom fields in the same call via a Custom Fields fixed-collection. Values are submitted as the backend-shape array `[{customFieldId, value}]`; categories are inferred server-side.
- **Custom Field > Submit Values rewritten for the multi-field endpoint.** Input is now a fixed-collection of `{customFieldId, type, value}` rows, targeting one or more entity IDs under a chosen category + optional sub-category. Old single-field flows keep working via a compatibility shim that synthesizes a one-row submission.
- **`Simplify` option on Get Many operations.** Printer, Queue, and Print Job list operations now expose a `simplify` boolean that reduces the response to the 10 most useful fields.

### Bug fixes

- **`custom_fields/SubmitValues` endpoint.** Earlier versions POSTed to `custom_fields/SetValues`, which does not exist — the operation would always fail with a 404. This release restores the feature.
- **Graceful 403 on custom-field dropdowns.** `loadCustomFields` catches the 403 that OAuth callers get today (the backend marks `custom_fields/Get` as `oauth_disabled`) and returns an empty option list rather than breaking the UI. Use the List operation + paste the UUID into the Custom Field ID column until the backend flip lands.

### Release hygiene

- Delete operations now return `{ deleted: true }` per n8n UX convention.
- Canonical SVG icon replaces the previous raster PNG; `eslint-plugin-n8n-nodes-base` runs with no per-line suppressions.
- `package.json` gains `bugs.url`, `engines.node`, and a properly typed `repository` object. `@n8n/node-cli` is pinned as a devDependency so `npx @n8n/scan-community-package` can run in CI.
- Codex metadata (`SimplyPrint.node.json`, `SimplyPrintTrigger.node.json`) added so the node appears with the right categories and docs URL in n8n's verified directory.

## 0.3.4

- Revert scope format back to space-separated (per RFC 6749). League's OAuth2 server parses scope by space; comma-separated caused League to see one giant "user.read,printers.read,..." scope name that isn't registered, triggering `invalid_scope`. SP's `comma_separated` validator turns out to be a no-op without a type parameter, so spaces work fine for that layer.

## 0.3.3

- Send OAuth scopes as comma-separated instead of space-separated. SP's `/api/0/oauth2/Authorize` uses a custom `comma_separated` validator on the scope param (non-standard; RFC 6749 specifies space-separated), which caused the whole scope string to be treated as a single invalid value and the authorize request was rejected as malformed.

## 0.3.2

- Actual fix for the OAuth URL. The consent screen is at `/panel/oauth2/authorize` (the route is declared with a `Pattern()` helper in `panel-routes.php` that prepends `/panel` when not in OEM mode). 0.3.1 used `/oauth2/authorize` which 404'd.

## 0.3.1

- Fix OAuth2 endpoint URLs. `/oauth/authorize` and `/oauth/token` route to SimplyPrint's MCP OAuth flow (Dynamic Client Registration, different client registry). The Activepieces-compatible pre-registered client flow lives at `/oauth2/authorize` (panel consent page) and `/api/0/oauth2/Token` (token exchange). 0.3.0 used the wrong pair and was rejected with "Unknown OAuth client".

## 0.3.0

- **Zero-config OAuth2.** The `SimplyPrint OAuth2 API` credential no longer asks for client ID / client secret / redirect URL - just click **Connect**. The node ships with a shared SimplyPrint-managed OAuth client that accepts any n8n callback URL. On first use for an unknown n8n instance, the SimplyPrint consent screen shows a warning with the redirect URL and a mandatory trust checkbox.
- Existing users who previously set up OAuth with their own client ID and secret should delete the old credential and create a new one; the hidden defaults now populate everything automatically.

## 0.2.8

- Stop relying on npm 11's auto-OIDC-detection (which wasn't firing on the runner for unknown reasons) and do the OIDC token exchange manually: curl the GitHub OIDC endpoint with audience `npm:registry.npmjs.org`, POST the resulting JWT to npm's token-exchange endpoint, use the returned short-lived publish token for `npm publish`.

## 0.2.7

- Strip `always-auth=false` from setup-node's .npmrc in addition to `_authToken`, since npm may interpret it as "user explicitly disabled auth" and skip OIDC. Also install `npm@latest` on the runner (Node 24's bundled npm 11.11 may have incomplete Trusted Publishing detection).

## 0.2.6

- Strip _authToken from the correct .npmrc path. setup-node writes its .npmrc at `$NPM_CONFIG_USERCONFIG` (typically `/home/runner/work/_temp/.npmrc`), not at `~/.npmrc`. The 0.2.5 strip step was a no-op because it looked at the wrong path, so npm kept reading the empty-token line and bypassing OIDC.

## 0.2.5

- Restore Trusted Publishing (OIDC) in the release workflow. Root cause of the earlier failures: `setup-node` with `registry-url` writes `~/.npmrc` with a line `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`. With no NPM_TOKEN set, that expands to an empty token, and npm uses empty-token auth instead of falling through to OIDC. Stripped that line after setup-node runs so npm 11 sees "no configured auth" and triggers the OIDC exchange. Added a one-shot diagnostic step that dumps OIDC claims so we can verify the exchange.

## 0.2.4

- (Never published.) Attempted NPM_TOKEN fallback, reverted before release.

## 0.2.3

- Remove `registry-url` from setup-node so no `.npmrc` auth template is written. With that template present, npm preferred empty-token auth over OIDC and 404'd on publish even with Trusted Publishing correctly configured.

## 0.2.2

- Switch the release workflow to Node 24 (which ships npm 11) to unblock Trusted Publishing. The previous attempt to run `npm install -g npm@latest` on Node 22 left npm in a broken state (MODULE_NOT_FOUND: promise-retry). No code changes since 0.2.0.

## 0.2.1

- Re-release of 0.2.0 content. The 0.2.0 tag never made it to npm: the release workflow's runner had npm 10.9.x (Node 22's bundled version), which signs a provenance attestation but silently falls back to token auth for the actual publish PUT, 404-ing against a scoped package. 0.2.1 attempted to fix by upgrading npm in-place on Node 22 — broke npm itself. See 0.2.2.

## 0.2.0

- Collapse 15 per-event trigger classes into a single `SimplyPrint Trigger` node with an Event dropdown. This matches the pattern used by first-party n8n integrations (HubSpot, Slack, Stripe) and makes the triggers appear correctly under the SimplyPrint integration card in the Node Creator (previously every event rendered as its own standalone card and the integration overview showed "No SimplyPrint Triggers available").
- Default both credentials' `Panel URL` to `https://simplyprint.io` (production) instead of the staging host.
- Drop the internal `install-on-home-server.sh` dev-loop script from the repo.

## 0.1.0 - Initial release

- Dual authentication (OAuth2 or API key) via a per-node authentication selector
- Main `SimplyPrint` action node with 8 resources and ~30 operations
- Custom API Call resource as an escape hatch for any unwrapped endpoint
- 15 webhook-based trigger nodes, one per SimplyPrint event
- Dynamic loadOptions dropdowns for printers, files, queue items, queue groups, filaments, tags and custom fields
- Constant-time webhook signature verification against per-workflow secrets
