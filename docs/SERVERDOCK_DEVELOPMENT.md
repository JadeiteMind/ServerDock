# ServerDock CPU workspace delivery

- Modified: 2026-11-02T23:56:26+08:00
- Type: feature / fork adaptation
- Product version: inherited 1.26.2; no ServerDock release published.
- Branch: codex/serverdock-cpu; target: JadeiteMind/ServerDock develop.
- Intended commit: feat: create ServerDock CPU workspace and explicit transfer modes

## Delivered

CPU, memory, Swap, disk mount capacity and CPU process views; reusable SSH connections, host fingerprint verification and terminals retained across navigation. GPU, NPU, PPU, accelerator installation and training controls are absent from the new UI and live collector. Legacy schemas, parsers, components and tests remain outside the new application entry for incremental migration.

Direct transfer is the default. Source-side rsync uses the source user's own SSH keys and strict target host verification. No local key copying or agent forwarding. A source-side flock prevents overlapping resumed transfers. Data is staged, then published only if the final destination remains absent. Pause retains staged data. Direct failure never silently switches to desktop relay. Relay is an explicit choice and retains upstream sync conflict checks and resume behavior; its update/delete semantics are documented in README.

Application identifier, database and keyring namespace are isolated from RackTop. Upstream update endpoints and updater IPC entry points are disabled. Manual GitHub packaging workflow targets this fork and requires no upstream signing secrets. No release, tag, installer upload or build workflow dispatch has been performed.

## Validation actually executed

- Frontend full suite: 350 passed, 15 skipped, before the final terminal-lifecycle addition.
- Latest affected ServerDock suite: 5 passed, including navigation retaining the same terminal component, CPU resource rendering, connection failures, explicit relay retry, and existing SSH Agent configuration.
- TypeScript and Vite production build: passed after the final UI change.
- Rust full suite: 108 passed, 3 ignored, before the final publication regression was added.
- Latest direct-transfer Rust suite: 2 passed. It executes the publication shell script against real temporary files, including quoted/spaced paths, and proves existing destination data and staging data survive a conflict; an absent destination receives the staged content.
- Windows native cargo build: passed. Development app launched and its native accessibility tree showed the independent empty-server workspace. Native form clicking could not be completed because input geometry was unavailable; startup validation is not end-to-end SSH validation.
- Browser checks: overview samples, server CPU/memory/disk details, default direct mode, and explicit relay selection observed.
- Contribution policy tests: 5 passed.
- git diff --check: passed.

## Remaining validation and limitations

- No user SSH endpoints were supplied. Real CPU collection, authentication, two-server rsync, interruption/resume and desktop relay have not been exercised against actual servers.
- macOS/Linux packaging and installer smoke tests have not run. The manual workflow has not been dispatched.
- Direct mode requires rsync on both ends and flock on the source, established source-to-target key authentication and independently trusted target fingerprints. It does not reuse desktop SSH aliases or ProxyJump on the data path.
- Direct mode requires a destination that does not yet exist. Relay has upstream synchronization semantics, including updates/deletions on subsequent syncs, and is best used with a dedicated destination directory.
- CPU process rows are capped at 64; CPU process percentages may exceed 100%. Disk values describe reported mounts, which may refer to shared physical storage.
- Existing upstream dead-code compiler warnings and frontend bundle-size warning remain. npm ci reported inherited dependency audit advisories; dependencies were not automatically upgraded as part of this feature.
