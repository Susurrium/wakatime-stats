# WakaTime 编程时间

为 [Susurrium's blog](https://susurrium.github.io/) 提供两项累计活动时长。

- VS Code：精确读取 WakaTime 的 `VS Code` 编辑器记录。
- Codex AI：精确读取 `Codex Vscode` 编辑器记录；当前本机 Codex Desktop 会话使用该来源。
- `Codex CLI` 单独统计，不并入桌面指标。同样使用 `vscode` 来源的 Codex IDE 会话可能被 WakaTime 合并到 `Codex Vscode`，来源变化时需重新核实配置。

![VS Code](badges/vscode.svg)
![Codex AI](badges/codex-ai.svg)
![统计更新时间](badges/updated.svg)

## 更新与公开范围

GitHub Actions 每小时第 17 分钟请求一次累计统计，也支持手动运行。定时任务可能受 GitHub 排队影响。采集由 WakaTime 官方 VS Code 扩展和 Codex 插件完成；此仓库只读取统计。

`WAKATIME_READ_TOKEN` 保存为 Actions Secret，使用 OAuth Bearer 认证。公开的 `stats.json` 只含两项来源的秒数、统计范围和时间戳，不包含项目、文件、机器、原始会话或凭据。读取接口为 `https://api.wakatime.com/api/v1/users/current/stats/all_time`。

`Updated` 使用 WakaTime 原始统计的更新时间，时区为 Asia/Shanghai。时长按整分钟向下取整，采用 WakaTime 的心跳计算规则，不能直接解释为模型纯计算时间或个人工作时间。

未找到来源、分类不一致、接口异常或刷新未完成时，任务失败并保留上一份已发布产物。`badges/` 和 `stats.json` 由脚本生成，不手动编辑。

## 维护

运行 `npm ci`、`npm test`，再以环境变量提供读取 Token 执行 `npm run update`。来源名称维护在 `config.json`。修改来源之前应检查实际统计返回，不能用账户总时间替代缺失来源。

博客可直接引用 `https://raw.githubusercontent.com/Susurrium/wakatime-stats/main/badges/vscode.svg` 和同目录的 `codex-ai.svg`、`updated.svg`。这些公开图片不需要访问令牌。

官方文档：[认证及统计接口](https://wakatime.com/developers)、[Codex 官方插件](https://github.com/wakatime/codex-cli-wakatime)。徽章通过 [badge-maker](https://github.com/badges/shields/tree/master/badge-maker) 生成。
