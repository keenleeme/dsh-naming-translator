# 发布上线

这个包已经是**可直接发布**的状态：不含构建步骤、不含依赖、`npm pack` 产物 9 个文件 29.2 kB，且从 tarball 解包后实测可用。

```bash
npm test          # 七组自检
npm pack          # 产物检查（不发布）
npm publish       # 发布到 npm（prepublishOnly 会再跑一遍测试）
```

仓库地址已经指向 `https://github.com/keenleeme/dsh-naming-translator`，下面按「发布到哪里」分成三条线，从私有自用排到公开市场。

---

## 发布状态速览

| 项 | 状态 |
|---|---|
| npm 包 | ✅ `@xpeanut/dsh-naming-translator@1.0.0` 已发布 |
| GitHub 仓库 | ✅ <https://github.com/keenleeme/dsh-naming-translator> |
| 市场收录条目 | ✅ 已备好，待开 PR（见路线三） |
| 仓库 `dsh-plugin` topic | ❌ 尚未设置，PR 前必须补 |
| 后续版本 | 改内容必须升 `version`，npm 不允许重复版本号 |

`engines.dsh` 的判定很特殊，值得单独说：Host 用 `semver.satisfies(运行时版本, range, { includePrerelease: true })` 比较，而且 **`engines.dsh` 一旦存在就单独决定结果，`peerDependencies` 被完全忽略**。所以 `>=0.2.2-rc.3` 在 `0.2.2-rc.3` 上判定为**满足**（实测确认），换成 `>=0.2.2` 反而不满足。

---

## 路线一：私有 / 团队内部分发

不发布到 npm，直接把包装到别人的机器上。

**方式 A：npm scope**（本包已经这样做）

```bash
npm publish --access public     # 发到 @xpeanut scope，人人可装
```

用户：

```bash
dsh plugin add @xpeanut/dsh-naming-translator
```

私有分发给团队时改 `--access restricted`，需要付费账号。

**方式 B：GitHub 仓库直装**（零发布成本）

```bash
dsh plugin add github:keenleeme/dsh-naming-translator
```

这个包**没有构建步骤**，所以 pnpm 不会要求批准任何 install 脚本，装起来很干净。

**方式 C：直接给 tarball**

```bash
npm pack                                    # 产出 xpeanut-dsh-naming-translator-1.0.0.tgz
dsh plugin add ./xpeanut-dsh-naming-translator-1.0.0.tgz
```

**方式 D：本地目录**（开发期用）

```bash
dsh plugin add /path/to/naming-translator
```

---

## 路线一·补：GitHub 仓库（已完成）

仓库已创建并推送：<https://github.com/keenleeme/dsh-naming-translator>

`main` 上现有三个提交，`origin` 已配置，`.gitignore` 排除 `*.tgz`，提交作者统一用 `keenleeme@users.noreply.github.com`（避免工作邮箱进入公开历史）。

**仍待完成**：给仓库加 `dsh-plugin` topic —— 仓库页 **⚙ Settings → Topics** 填入。这是市场收录的硬性检查项，缺了 PR 会被 gate 拦住。

---

## 路线二：发布到 npm 公开包

### 已发布（2026-11-23）

| 项 | 值 |
|---|---|
| 包名 | `@xpeanut/dsh-naming-translator` |
| 版本 | `1.0.0` |
| 安装 | `dsh plugin add @xpeanut/dsh-naming-translator` |
| 页面 | <https://www.npmjs.com/package/@xpeanut/dsh-naming-translator> |
| tarball sha1 | `3a7cfe2376f47095b6b85aa9a64bfc5429335692`（与 `npm publish` 输出一致） |

后续版本：

```bash
npm version patch                     # 或 minor / major
npm publish --userconfig <指向官方源的配置>
```

### 坑一：scope 不需要建组织

npm 上 `@xpeanut` 这个 scope **不需要建组织**。当用户名与 scope 同名（账号叫 `xpeanut`）时，npm 自动把它当作个人 scope，首次发布直接建包并绑定到账号。

因此去 `npmjs.com/org/create` 填同名 `xpeanut` 会得到 **"This name is unavailable"**——那不是重名冲突，而是该名字已被自己的个人 scope 占用。**这条路是错的，不要走。**

判断 scope 是否可用，看 packument 而不是组织端点：

```bash
npm view @xpeanut/dsh-naming-translator version    # 返回版本号 = 已落地
```

`GET /-/org/xpeanut` 返回 404 只说明「没有组织」，与能否发布无关。

### 坑二：publish 的退出码不能当作发布结果

`npm publish` 打印 `Your package is being processed and may take a few minutes to become available.` 之后，registry 在一两分钟内仍是 404。这次因此被误判为「发布失败」。

**验证必须查 packument 并校验 tarball，不能看退出码或即时回查：**

```bash
npm view @xpeanut/dsh-naming-translator dist.tarball dist.shasum
# 下载 tarball 比对 sha1，再解包跑 tools/dnt-tarball-check.mjs
```

### 坑三：token 的 scope 决定了能发什么包名

本次用的 granular token 权限是 `@xpeanut` scope + `package:write` + `bypass_2fa`：

- 它 **只能写 `@xpeanut/` 下的包**。发无作用域的 `dsh-naming-translator` 会得到 `403 You may not perform that action with these credentials`（凭据本身有效，是权限不够）。
- 想发无作用域包名，必须重新生成 scopes 选 "All packages" 的 token，或改用账号 2FA + `--otp`。
- bypass 2FA 的 token 正在被逐步限制：npm 公告账号变更自 2026-08 起受限、直接发布自 2027-01 起受限。长期应改为开 2FA 后用 `npm publish --otp=<6位码>`。
- token 一旦泄露立即吊销：<https://www.npmjs.com/settings/xpeanut/tokens>

### 首次发布留下的占位版本

registry 里除 `1.0.0` 外还有一个 `0.0.0-stage`，描述为 `Temporary package placeholder for staged publishing`。这是 npm 在 scope 首次发布时自动插入的暂存占位包，不是本仓库代码，不在 `latest` 标签上，不影响安装。清理：

```bash
npm unpublish @xpeanut/dsh-naming-translator@0.0.0-stage
```

### 发布后的验证（本次实际执行）

1. `npm view @xpeanut/dsh-naming-translator version` → `1.0.0`
2. 下载 `dist.tarball`，sha1 与 `npm publish` 输出一致
3. 解包 9 个文件齐全，`node tools/dnt-tarball-check.mjs ./package` 通过
4. `dsh plugin add @xpeanut/dsh-naming-translator` 真实安装，确认 `application: applied`
5. 刷新页面，输入框工具行出现 `{}` 命名按钮，输入「用户信息」得到 `userInfo`

---
 
## 路线三：上架 DSH 插件市场（真正意义上的「上线」）

这是让用户在 **Plugins → Discover** 里搜到你的唯一途径。关键事实：**市场本身不接受投稿**，它读的是一个独立的精选清单仓库。

官方 README 明确写着：

> The plugin list comes from the curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) registry — to get your plugin listed in the market, open a PR **there** (one entry in the list; the site and this market pick it up automatically, usually within a day). Please don't PR plugin entries against this repo.

也就是说，完整链路是：

```
你的 npm 包  →  awesome-dsh-plugin 仓库 PR  →  市场自动同步（通常一天内）
```

### 条目已经写好了

投稿只需要**一个文件**，放在该仓库的 `data/plugins/<owner>__<repo>.yml`。本仓库已按此格式准备好，内容如下：

```yaml
url: https://github.com/keenleeme/dsh-naming-translator
name: keenleeme/dsh-naming-translator
category: dev
description:
  en: 'Translates Chinese phrases into camelCase variable and method names from the composer tool row, using a built-in developer dictionary first and one model call only when it cannot cover the phrase.'
  zh: '在输入框工具栏把中文表述翻译成 camelCase 变量名或方法名：优先查内置开发词典，词典覆盖不到时才调用一次模型。'
icon: https://raw.githubusercontent.com/keenleeme/dsh-naming-translator/main/assets/icon-180.png
```

原件在 [`.awesome-dsh-plugin/keenleeme__dsh-naming-translator.yml`](.awesome-dsh-plugin/keenleeme__dsh-naming-translator.yml)，`npm test` 里的 `dnt-registry-check.cjs` 会逐条核对它是否符合收录规则（分类取值、描述标点、`: ` 引号转义、icon 必须是 GitHub 托管的位图、截图路径不能跳出仓库等）。

### 开 PR 的步骤

```bash
# 1. Fork 并克隆清单仓库
git clone https://github.com/<你的账号>/awesome-dsh-plugin.git
cd awesome-dsh-plugin

# 2. 新建分支，放入那一个文件
git checkout -b add-dsh-naming-translator
mkdir -p data/plugins
cp <本仓库>/.awesome-dsh-plugin/keenleeme__dsh-naming-translator.yml data/plugins/

# 3. 提交并推送
git add data/plugins/keenleeme__dsh-naming-translator.yml
git commit -m "Add dsh-naming-translator"
git push -u origin add-dsh-naming-translator
```

然后在 GitHub 上开 PR。**不要手工改 README**——两份 README 都由 `data/plugins/*.yml` 生成，会自动重新生成。

### 三道硬门槛（提交前必须满足）

| 门槛 | 要求 | 本仓库状态 |
|---|---|---|
| 仓库年龄 | ≥ 1 天（CI 自动检查） | ⚠️ **刚建好，需要等到第二天** |
| `dsh-plugin` topic | 在 GitHub 仓库页设置 | ⚠️ **需在仓库 Settings 里手动添加** |
| `dsh.bundle` 清单 | `package.json` 声明 `dsh.bundle.patch` | ✅ 已声明，`cordis.patch.yml` 就位 |

仓库年龄不满足时 PR 会被 gate 挡住，但**几小时后自己会达标**，不需要重推。topic 需要手动点：仓库页右上 **⚙ Settings** → Topics 里加 `dsh-plugin`。

### 市场对插件的硬性要求，逐条对照

| 要求 | 本包状态 |
|---|---|
| 市场安装仅限精选清单内的来源 | ✅ 条目已备好，只差 PR |
| 构建脚本默认被 pnpm≥10 拦截 | ✅ 无构建脚本、无依赖 |
| `meta.title` / `meta.description`（en + 用户语言） | ✅ `locale/en.json`、`locale/zh.json` |
| 插件列表图标（SVG/PNG/JPEG/WebP ≤ 256 KiB） | ✅ `icon.svg`，756 B |
| 市场卡片图标：**必须是位图** | ✅ `assets/icon-180.png`（180×180，SVG 会被拒） |
| 截图（1–8 张，GitHub 托管） | ✅ `screenshots.json` → `assets/preview.png` |
| 声明 `engines.dsh` 供兼容性过滤 | ✅ `>=0.2.2-rc.3` |
| README 说明功能与用法 | ✅ |
| 描述必须属实，不带营销词 | ✅ 数字（约 400 条 / 143 条）与代码一致，自检脚本会核对 |

---

## 发布后要做的验证

发布 ≠ 可用。按顺序确认：

1. **tarball 内容正确**（本仓库已自动化）：
   ```bash
   npm pack && tar -xzf dsh-naming-translator-*.tgz
   node tools/dnt-tarball-check.mjs ./package
   ```
   这一步会真的挂载 Host 半边、调一次路由、再加载浏览器半边，而不是只看文件名。

2. **干净环境安装**：在另一台机器或另一个 profile 上 `dsh plugin add dsh-naming-translator`，确认 `application: applied`。

3. **页面里真的出现**：刷新页面 → 输入框工具行出现 `{}` 命名按钮 → 点开输入「用户信息」→ 得到 `userInfo`。**仅凭安装成功不能说明界面可用**。

4. **升版本要重启**：替换已安装的包需要重启 Host 才会加载新的 JS 模块；新装则可能通过 HMR 直接生效。

---

## 已知的发布限制

- **只输出 camelCase**。PascalCase / snake_case / kebab-case / CONSTANT 都没实现，README 里已如实写明。
- **模型兜底依赖用户自己的 provider**。没配模型时字典仍可用，面板会显示「当前环境无法调用模型」。
- **词典是人工维护的**。领域专有词靠预置词条 + 用户自定义，不承诺覆盖一切。
- **`tools/` 不进发布包**。自检脚本只在仓库里，`files` 已排除。
