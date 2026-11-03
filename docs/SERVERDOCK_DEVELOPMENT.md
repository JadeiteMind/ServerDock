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

## 2026-11-03 — Restore upstream SSH Config import

The first fork removed the SSH Config import entry while retaining its backend. This update restores the original read → select → deduplicate → save workflow. The upstream and ServerDock entries now share SshImportSheet, rather than maintaining independent copies. ServerDock refreshes saved entries after a partial failure so retry skips successful saves. Sidebar, overview and the native import menu use the same action. The default file is the user's .ssh/config; wildcard-only Host blocks are excluded by the existing upstream parser.

Targeted validation: 11 tests passed for ServerDock/import identity, plus 15 upstream collection/terminal regression tests. Cases cover preserving SSH aliases/key/ProxyJump/port, skipping existing connections, retrying a partial import, missing or empty files, CPU views and terminal lifecycle. TypeScript/production build and local desktop deployment are checked as part of this update. No remote hosts are automatically trusted, no remote SSH configuration is modified, and real server details are not committed.

Upstream capability audit: SSH terminals, host key verification, authentication methods, CPU metrics, disk capacity and transfer conflict/resume logic remain. Server ordering/deletion, historical views, general settings, and project/resource management still need separate parity work; this update does not claim those upstream surfaces are all restored. Further removal should be confined to accelerator-specific features.

## 2026-11-03 — Tsinghua purple, storage totals and user resource view

- Theme uses the official Tsinghua purple RGB(102,8,116), #660874. Source: https://vi.tsinghua.edu.cn/info/1150/1205.htm and the university's published visual standards. Status green/red remain semantic online/error indicators.
- Fleet storage and each server card show used / total reported mount capacity. Missing samples show unknown rather than implying zero capacity.
- New user-resource tab groups full visible process ownership/RSS by UID, independently of the 64-row process detail cap. Default filtering shows regular accounts and the current SSH user; the system-account toggle includes service/root accounts. Counts describe process owners, not login sessions or all system accounts.
- CPU is derived from matching PID and process-start-time counters across a short /proc sampling window, divided by whole-machine CPU tick delta. Unknown/reused/unreadable samples remain unknown; the table shows matched-process coverage. The CPU denominator excludes guest/guest_nice to avoid double counting.
- RSS is summed per user and may double count shared memory. Permission restrictions, processes that start/exit during sampling and per-process scan timing affect coverage. No per-user disk traversal is introduced. Legacy snapshots deserialize with default empty user samples.

Validation: frontend full suite 357 passed / 15 skipped; Rust full suite 110 passed / 3 ignored, plus the final guest-accounting assertion passed in the affected user-resource test. Tests include >64 process aggregation, PID reuse, zero CPU intervals, system-user filtering, unknown CPU values, storage used/total rendering and the new tab route. TypeScript/Vite production build passed. The collector ran successfully under local WSL Linux without exposing raw process data in source control. Browser checks observed storage 5.7 / 15.0 TiB, two regular demo users and three including root. Screenshots use demo data. Live configured Linux servers were checked for resource collection in this update; cross-server transmission was not exercised.

The optimized standalone Windows build for these changes passed and replaced the local preview executable. No public installer/release was published.

Live-collection compatibility check found that an older CentOS 7 ps parsed the comma-separated empty-header format as a single PID column. User ownership sampling now uses `ps -eo pid,uid,user:64,rss --no-headers`; the full read-only collector ran successfully on that system with valid PID/UID/username/RSS rows. Existing endpoint names, addresses, usernames and raw telemetry are excluded from this report.

## 2026-11-03 — Readable typography and per-server user data disks

Homepage labels and tables use larger typography and dark, high-contrast text with the Tsinghua purple theme. User resources now discover immediate username directories under reported data mounts and /mnt/data* or /data*, including inactive regular local accounts. Each server can save selected/custom absolute paths locally. Home directories are not the default storage scope.

Storage scans run asynchronously, globally limited to two servers, with low-priority du -sx -B1 and a 60-second remote deadline per directory. CPU/memory collection continues. Symlink aliases and nested directories for the same UID are excluded from subtotals. Errors/cancellation retain successful cached bytes with timestamps; unknown is never reported as zero. Submounts are excluded; shared directories assigned to different users may be counted for each user. No sudo or remote file deletion is used.

Final validation: frontend full suite 360 passed / 15 skipped; Rust full suite 112 passed / 3 ignored. The directory integration test runs GNU du against temporary files and verifies quoted/spaced paths and parent overlap. TypeScript/Vite and optimized standalone Windows builds passed. The installed local executable was replaced with the final build. Earlier browser demo checks verified the new resource and directory interface; the final browser recheck was blocked by the automation service reporting browser.user unavailable. Real cross-server transfer and macOS/Linux packaging remain untested. Version stays 1.26.2; no release, tag or workflow dispatch.

## 2026-11-03 — Window drag and notification-area tray

The full header and nested brand content explicitly start native window dragging; interactive controls are excluded, and double-click toggles maximization. The sticky header remains accessible while scrolling. Reuses the existing tray rather than adding a floating miniature window. Its stable menu items and tooltip show online/total servers, failures, average CPU, aggregate memory percentage and the most recent sample time. Updating individual menu labels avoids dismissing an open menu. Clicking the Windows tray icon restores/unminimizes the main window. Menu actions show, hide to tray, or explicitly quit. Closing the main window now hides it and preserves monitoring/terminals; explicit quit closes terminals and exits. Windows may place new tray icons under its overflow arrow.

Validation: affected ServerDock suite 12 passed, including titlebar whitespace, nested brand, control exclusion, double-click and tray summary aggregation on partial connection failure; Rust full suite 112 passed / 3 ignored. TypeScript/Vite production build passed. Version stays 1.26.2; no release/tag/installer upload.
