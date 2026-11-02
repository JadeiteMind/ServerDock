# ServerDock

面向 CPU 服务器的 Linux 桌面工作台，基于 [RackTop](https://github.com/Tongzh-SEU/RackTop) 开发。

## 功能

- 服务器总览：CPU 使用率、系统负载、内存、Swap 和磁盘容量。
- 进程列表：CPU 占用、常驻内存、用户、运行时间和命令。
- SSH Config 一键导入：读取本机 `~/.ssh/config`，批量选择 Host，自动跳过重复连接，保留 SSH 别名、密钥和 ProxyJump。
- SSH 终端、SSH Agent / 密钥 / 密码 / SSH Config 连接和主机指纹核验。
- 跨服务器文件、目录传输：直接传输优先；可显式选择本机中转。
- 独立应用标识 `io.github.jadeitemind.serverdock` 和本地数据库，不读取 RackTop 的应用数据。

ServerDock 不展示 GPU/NPU/PPU、显存、驱动安装和训练配置。当前代码中保留部分上游模型、解析器、组件和测试以便渐进迁移；桌面入口使用 `src/ServerDock.tsx`，远端资源采集使用 `src-tauri/assets/serverdock-collector.sh`。

## 数据传输

### 服务器直接传输（默认）

数据由源服务器通过 rsync/SSH 发送到目标服务器，不经过桌面客户端。控制连接仍由桌面客户端维护。

前提：两端有 `rsync`，源端有 `flock`，源服务器能直接访问目标的主机地址和端口，源用户自己的密钥已获得目标权限，且源服务器的 `known_hosts` 中已独立核验目标指纹。不会复制本机私钥、转发本机 SSH Agent 或自动接受未知指纹。首版不复用本机 SSH 别名和 ProxyJump 到远端传输链路。

填写源完整路径和目标完整路径（绝对路径或 `~/...`）。目标路径必须不存在；传输先写入同级 `.serverdock-*.part` 暂存路径，成功后再发布。暂停后保留暂存文件，再次使用同一任务和方式可利用 rsync 恢复。传输时不要同时修改源数据。不会自动删除源文件或覆盖现有目标。

### 本机中转

两端只需分别能从本机通过 SSH 访问，文件数据流经过本机网络。复用上游项目同步的进度、冲突检查、暂存发布与续传机制。本机中转是同步语义：后续重试可能更新目标文件或移除源端已删除的文件，首版没有强制覆盖冲突入口。建议使用专用目标目录。

直接传输失败后不会自动改走本机。用户可以在传输记录中选择“本机中转”后重试；两种方式使用不同的暂存文件，不共享续传偏移。

## 本地开发

Windows 桌面开发需要 Node.js 22+、Rust stable、Visual Studio C++ Build Tools、WebView2 和系统 OpenSSH。运行 Rust 中的 shell 集成测试时，需将 Git for Windows 的 `bin` 目录加入当前终端 PATH，提供 `sh.exe`。

```sh
npm ci
npm run dev
npm run tauri dev
```

网页预览为演示数据，不能执行真实 SSH 和文件传输。服务器须为 Linux，采集依赖 `/proc`、procps、GNU coreutils；首版未提供非 Linux 采集。

```sh
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

GitHub Actions 的 Build ServerDock 工作流仅手动运行，生成桌面安装包，不自动发布 Release。上游自动更新已停用，避免将 ServerDock 更新为 RackTop；当前版本号暂沿用上游 1.26.2，不代表 ServerDock 已发布。

磁盘统计按 df 报告的挂载点显示；bind mount 或共享后端可能重复计量，不代表物理磁盘总容量。CPU 进程百分比按单逻辑核心计，可超过 100%。进程列表保留最多 64 条，容量采样每 60 秒，手动刷新可立即更新。

## 许可证与来源

保留 [GPL-3.0](LICENSE) 许可证和 RackTop 上游贡献历史。原项目由 [Tongzh-SEU](https://github.com/Tongzh-SEU/RackTop) 开发；ServerDock 的 CPU 工作台与传输改造在本 fork 维护。
