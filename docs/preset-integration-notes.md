# Terminal Session preset integration

These files target DSH `0.2.1-rc.2`, upstream commit `687f282e8625c6b8d11ff58211a90524be2e4317`. `presets/{standard,ptc,minimal,cordis}.patch.yml` are byte-for-byte copies of `packages/bundle/web-app/presets/` at that release. Their provenance is checked by SHA-256 in `tui/tests/presets.spec.ts`.

## Bundle composition

Apply the terminal's existing `cordis.patch.yml` first, then these patches in order: `presets/base-disable.patch.yml`, `presets/registry.patch.yml`, `presets/standard.patch.yml`, `presets/ptc.patch.yml`, `presets/minimal.patch.yml`, `presets/cordis.patch.yml`. Publish the files and list them in `dsh.bundle.patch`; neither a directory on disk nor a package dependency activates the declarations. These integration points belong to the bundle manifest and host runtime.

The disable patch removes all 23 agent-plane contributions disabled by upstream `web-app/cordis.patch.yml:477-580`, plus the terminal's global `time-context`, `tool-present`, `tool-ask-user` and `tool-schedule` rows. Their canonical IDs are exported as `BASE_AGENT_PLUGIN_IDS`. Leaving any global model-facing row enabled can widen `minimal` through inheritance. Preserve the Host tool and skill registries, jobs, goals, subagent registry/backends, token meter, filesystem, shell-env, schedule, storage, projections and persistence. Keep deployment `tools.mode` at `native`; the PTC declaration selects its own scoped presentation. A process-wide PTC override would also affect the standard and minimal declarations.

The registry patch mounts one `agentPresets` registry with default `standard`, one `cordis-host-runner`, and one Host inspect-provider registration. Do not mount duplicate Host inspect providers in individual presets. The Cordis declaration exposes `cordis_inspect_list` and `cordis_inspect_query`. Client providers require a real connected Harness page; a terminal must not manufacture browser Slots or Theme providers.

`plugin_market` remains optional. The Cordis declaration enables its tool row only in a profile and the tool registers only when a Host `pluginMarket` exists. Standard and PTC explicitly disable both plugin-manager and market tools; minimal declares neither. Mount the market Host service separately for terminal market browsing. The experimental market bundle also contains Web UI and is unnecessary for a terminal-only deployment.

## Runtime integration

Construct `new TerminalPresets(ctx)` with the Host context. `list()` returns the official roster, including `broken` diagnostics and default markers; `read(id)` returns declaration YAML. The UI should display failures and avoid offering them as working choices.

For a new Session, await `setup(requestedId)`, set `meta.agentPreset` only when the returned identity exists, and combine its `setup` callback with the runtime's existing model-selection setup. Await that callback inside `ctx.agents.create`, before publication. A declaration may fail activation after resolution: preserve the Agent factory's rejection and rollback; do not substitute another preset.

For cold resume, call `restore(agentCtx, agent)` from the `ctx.agents.resume({ setup })` callback. Persistence has reconstructed the Session by then. The helper reads the current `agentPreset` projection and mounts it before publication. It does not change the header or append selection records. `setup(undefined, existingSession)` is also available when a reconstructed Session is already owned by the caller. A missing recorded declaration is an error rather than permission to choose the default.

For an existing blank Session, call `select(agent, id)` and update the terminal display only after it resolves. The official registry serializes switches, checks `turnBoundary`, mounts the new scope, and appends `agent-preset/selected`. After the first turn starts, it returns `agent-preset/locked`; a completed first turn also stays locked. Do not use `recompose` directly for UI selection, since it delegates the blank-session check to its caller.

Use `current(session)` to label the running composition. The immutable `session.header.agentPreset` only records creation and can become stale while the Session is blank. Scoped tools must always be queried with the current Agent. Use `serviceFor(agent, name)` for plan mode, compaction and other isolated services: it searches the retained preset revision before falling back to the Agent's deployment service. Ordinary `agent.ctx.get(name)` alone cannot find a provider isolated inside a preset group.

Legacy deployments without `agentPresets` keep an empty roster and no-op setup; an explicit selection or a recorded preset without its registry fails. Agent, Session, cancellation, model-selection and owned-handle lifecycles remain the host runtime's responsibility.

## Dependencies and build

The bundle's resolver manifest must declare each bare plugin package referenced by these YAML files. Newly introduced host packages are `@deepseek-ai/dsh-agent-preset-registry`, `@deepseek-ai/dsh-agent-preset`, `@deepseek-ai/dsh-cordis-host-runner`, `@deepseek-ai/dsh-tool-cordis`, and the preset-owned `@deepseek-ai/dsh-persona`, `@deepseek-ai/dsh-agent-tool-presentation`, `@deepseek-ai/dsh-terminal`, `@deepseek-ai/dsh-terminal-bash`, `@deepseek-ai/dsh-tool-bash-persistent`, `@deepseek-ai/dsh-tool-pwsh-persistent`. Existing base packages still need to be resolvable from the declaration's package base. The Cordis skill path also resolves `@deepseek-ai/dsh-agent-preset/package.json` at runtime. PTC needs the existing Host PTC runtime; minimal needs the persistent terminal provider and attachment/filesystem services for `read_image`.

The TypeScript project needs the registry's Context and projection declarations; `presets.ts` imports them only as types. Add the registry to the plugin's peer/dev dependencies and its workspace `references`; the tests also import the official declaration plugin. Source tests run through the upstream Vitest aliases and standard-decorator transform. Mirror the root `presets/` directory beside the existing mirrored terminal patch, so `tui/tests/presets.spec.ts` resolves the same checked files in either checkout. The standalone release manifest must ship the root preset patches.

## Verification boundary

The offline tests use the real Cordis Loader, official preset declaration plugin, official registry, Session projections and Agent factory. Test-only tool contributions establish standard-to-minimal isolation, another Agent retaining standard, isolated service lookup, first-turn locking, current-selection reconstruction, missing/broken declaration failures and factory rollback without a model request. Byte hashes separately establish fidelity of all four shipped declaration files. These tests do not establish that every dependency of the full release composition has activated; the host integration must additionally boot the combined bundle and verify all four roster entries have no `broken` field before claiming that end-to-end behavior.

## Full profile and source-entry verification

Run from this checkout after building the upstream rc.2 artifacts described in `full-preset-boot.mjs`:

```sh
node docs/full-preset-boot.mjs > docs/evidence/preset-profile-boot.json 2> docs/evidence/preset-profile-boot.stderr.log
node docs/full-preset-boot.mjs --source > docs/evidence/preset-source-boot.json 2> docs/evidence/preset-source-boot.stderr.log
```

An optional positional argument supplies another upstream checkout. Project paths derive from `import.meta.url`; the scripts require no external `/tmp` helper. Both modes create and remove their own temporary `DSH_HOME`, profile, empty config, credentials path and storage roots. The child receives a restricted environment and empty working directory. Only `node_modules/@crazyhappyone/dsh-tui` is linked in the fixture profile. Neither mode installs packages, reads the real user profile or submits prompts. Both reject and count `fetch` calls; `request/header` events fail the checks. Interactive terminal/Web servers and telemetry are disabled so the check exits after inspection.

The default mode loads the temporary profile with official `loadProfileDirectory`, computes `createRuntimeResolution` using the real `apps/cli/package.json` installation anchor, activates `PluginPackages`, and boots all profile layers through published AppBoot. `--source` launches the actual `apps/cli/src/bin.ts` through installed `tsx/esm`, passing only `--profile tui --patch <temporary offline overlay>`; a temporary lifecycle plugin inspects the ready application. The common contract in `preset-boot-contract.mjs` mounts every official declaration, inspects scoped tools/model presentation and commands, queries the real Host Tool inspect provider, and disposes all Agent handles.

Both recorded runs passed with 591 installation mappings, four healthy declarations and zero network/model requests. Scoped tool counts were standard 31, PTC 31, minimal 3 and Cordis 35. PTC model presentation was exactly `run_code`; minimal exposed exactly `bash`, `read_image`, `working_directory`. Cordis had both inspect tools, plugin manager and market. Standard and minimal did not inherit PTC presentation. Both stderr logs were empty.

Direct links for registry, persona and market in the CLI root `node_modules` are not needed in this installed checkout: the official installation dependency traversal finds registry through `packages/subagent/tool-subagent/node_modules`, persona through `apps/cli/node_modules`, and market through `packages/bundle/web-app/node_modules`. `profile.ts`'s `collectInstallationScopePackages`/`createRuntimeResolution` builds these mappings; `profile-boot.ts` installs `PluginPackages` before bundle activation. Therefore adding root links or reinstalling this existing linked profile is not indicated by the tested dependency graph. This result covers the base + local bundle composition; additional extensions and private settings in a user's existing profile were not booted or validated.
