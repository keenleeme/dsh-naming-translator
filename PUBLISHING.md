# 发布上线

这个包已经是**可直接发布**的状态：不含构建步骤、不含依赖、`npm pack` 产物 9 个文件 29.2 kB，且从 tarball 解包后实测可用。

```bash
npm test          # 七组自检
npm pack          # 产物检查（不发布）
npm publish       # 发布到 npm（prepublishOnly 会再跑一遍测试）
```

仓库地址已经指向 `https://github.com/keenleeme/dsh-naming-translator`，下面按「发布到哪里」分成三条线，从私有自用排到公开市场。

---

## 发布前还需确认的两处

仓库地址、作者、许可证都已填好，剩下这两处按需确认：

| 位置 | 当前值 | 说明 |
|---|---|---|
| `version` | `1.0.0` | npm 上已发布版本不能重复，改内容必须升版本 |
| `engines.dsh` | `>=0.2.2-rc.3` | DSH 用它判断能否安装；写低了低版本用户装不了，写高了高版本用户被挡 |

`engines.dsh` 的判定很特殊，值得单独说：Host 用 `semver.satisfies(运行时版本, range, { includePrerelease: true })` 比较，而且 **`engines.dsh` 一旦存在就单独决定结果，`peerDependencies` 被完全忽略**。所以 `>=0.2.2-rc.3` 在 `0.2.2-rc.3` 上判定为**满足**（实测确认），换成 `>=0.2.2` 反而不满足。

---

## 路线一：私有 / 团队内部分发

不发布到 npm，直接把包装到别人的机器上。

**方式 A：npm 私有 scope**（推荐给团队）

```bash
# 改名为 @你的scope/dsh-naming-translator
npm publish --access restricted
```

同事：

```bash
dsh plugin add @你的scope/dsh-naming-translator
```

**方式 B：GitHub 仓库直装**（零发布成本）

```bash
dsh plugin add github:keenleeme/dsh-naming-translator
```

这个包**没有构建步骤**，所以 pnpm 不会要求批准任何 install 脚本，装起来很干净。

**方式 C：直接给 tarball**

```bash
npm pack                                    # 产出 dsh-naming-translator-1.0.0.tgz
dsh plugin add ./dsh-naming-translator-1.0.0.tgz
```

**方式 D：本地目录**（开发期用）

```bash
dsh plugin add /path/to/naming-translator
```

---

## 路线一·补：创建 GitHub 仓库并推送

仓库地址已经写进 `package.json`，但**仓库本身还没在 GitHub 上创建**，所以下面这一步需要你手动做（我没有你的 GitHub token，无法代建）。

1. 打开 <https://github.com/new>，填：
   - **Repository name**：`dsh-naming-translator`
   - **Visibility**：`Public`（上架市场必须公开，市场从 GitHub 抓说明和截图）
   - **不要**勾选 "Add a README file"、"Add .gitignore"、"Choose a license" —— 这三样本地都有了，勾了会造成首次推送冲突。
2. 创建后回到本地推送：

```bash
cd naming-translator
git push -u origin main
```

首次推送会弹出 GitHub 登录窗口（本机已配置 Git Credential Manager，账号 `keenleeme` 已在其中）。

推送完确认：<https://github.com/keenleeme/dsh-naming-translator>

> 本机 `git init` 与首次提交已经完成（commit `ededde3`，21 个文件、2881 行），`origin` 已指向 `https://github.com/keenleeme/dsh-naming-translator.git`，`.gitignore` 也确认会排除 `*.tgz`。所以只差上面这两步。

---

## 路线二：发布到 npm 公开包

```bash
npm login                       # 只需一次
npm whoami                      # 确认已登录
npm version patch               # 或 minor / major
npm publish                     # prepublishOnly 自动跑 npm test
```

发布后任何人可以：

```bash
dsh plugin add dsh-naming-translator
```

**注意同名问题**：`dsh-naming-translator` 目前在 npm 上**未被占用**（已实测），但谁先发布谁拥有。如果不想赌，可以先用 `npm view dsh-naming-translator` 复查一次。

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
