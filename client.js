/**
 * Naming Translator — browser half of the bundle.
 *
 * Registers one compact control in the composer tool row
 * (`conversation.input.left`). Clicking it opens a popover where a developer
 * types a Chinese phrase — 「用户信息」「订单分页查询」 — and gets the camelCase
 * identifier to use in code: `userInfo`, `orderPageQuery`.
 *
 * Translation order:
 * 1. the plugin's own Chinese→English dictionary, greedily tokenized, which
 *    answers the overwhelming majority of everyday developer vocabulary and
 *    needs no network round trip;
 * 2. the developer's own glossary (`localStorage`, plugin-owned key), which
 *    overrides the dictionary term by term;
 * 3. the Host model fallback (`POST /naming-translator/translate`), used only
 *    for phrases the first two cannot account for in full.
 *
 * Deliberate boundaries:
 * - The module is served as a plain browser bundle, so it requires only the
 *   platform-seeded `react`/`react-dom` and never imports a Harness client
 *   package: the controls, the icons, and the CSS are all local.
 * - Styling uses only `--dsw-*` theme tokens, so the control follows light and
 *   dark themes and sits next to its neighbours in the tool row.
 * - The popover portals to `document.body`: the composer card clips fixed
 *   overlays, so an in-place dropdown would be cut off.
 * - Nothing is written outside the plugin-owned storage key.
 *
 * @module dsh-naming-translator/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-naming-translator',
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const h = React.createElement;
    /** `createPortal` keeps the popover out of the composer's clipping box. */
    let createPortal = null;
    try {
      const reactDom = require('react-dom');
      if (typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal;
    } catch {
      createPortal = null;
    }

    //#region constants
    /** Package name; also the module id this bundle registers under. */
    const PACKAGE_NAME = 'dsh-naming-translator';
    /** Locale namespace owned by this plugin. */
    const NS = 'naming-translator';
    /** Declared by ui-conversation (`kind: 'list'`, `scope: 'session'`). */
    const SLOT = 'conversation.input.left';
    /** List-slot entry id; unique within the slot. */
    const SLOT_ID = 'naming-translator';
    /** Right after the shipped attach control, ahead of the model selector. */
    const SLOT_ORDER = 60;
    /** Custom glossary key. Plugin-owned and versioned by name. */
    const GLOSSARY_KEY = 'dsh-naming-translator/glossary';
    /** Marks that the seed glossary has been installed once for this browser. */
    const SEEDED_KEY = 'dsh-naming-translator/seeded';
    /** Host route that answers dictionary misses. */
    const ROUTE = '/naming-translator/translate';
    /** Longest accepted phrase; the Host enforces the same bound. */
    const MAX_INPUT = 240;
    /** Translations kept for re-opening the popover in one session. */
    const HISTORY_LIMIT = 8;
    /** Chinese particles and filler that carry no identifier meaning. */
    const STOPWORDS = new Set([
      '的', '了', '和', '与', '及', '在', '是', '把', '给', '对', '将', '为', '着', '过',
      '请', '帮', '我', '一个', '一下', '我的', '这个', '那个', '需要', '进行', '等等',
    ]);
    //#endregion

    //#region dictionary
    /**
     * Chinese→English developer vocabulary. Values are lowercase latin words;
     * a multi-word value is joined with spaces and contributes several
     * identifier words (`信息` → `info`, `分页` → `page`).
     *
     * Tokenization is greedy-longest-match, so longer keys win: `用户信息`
     * needs no entry because `用户` and `信息` cover it, and an entry such as
     * `购物车` shadows the separate `购物`/`车` pair.
     */
    const DICT = {
      // ── people and accounts ────────────────────────────────────────────────
      '用户': 'user', '用户名': 'username', '用户信息': 'user info', '会员': 'member',
      '客户': 'customer', '顾客': 'customer', '买家': 'buyer', '卖家': 'seller',
      '员工': 'staff', '员工信息': 'staff info', '管理员': 'admin', '管理': 'manage',
      '账号': 'account', '账户': 'account', '密码': 'password', '手机': 'mobile',
      '手机号': 'mobile', '电话': 'phone', '邮箱': 'email', '邮件': 'mail',
      '地址': 'address', '姓名': 'name', '昵称': 'nickname', '头像': 'avatar',
      '身份': 'identity', '实名': 'real name', '昵称名': 'nickname',
      '角色': 'role', '权限': 'permission', '授权': 'auth', '部门': 'dept',
      '组织': 'org', '职位': 'position', '岗位': 'post', '供应商': 'supplier',

      // ── common nouns ───────────────────────────────────────────────────────
      '名称': 'name', '名字': 'name', '标题': 'title', '内容': 'content',
      '描述': 'description', '备注': 'remark', '状态': 'status', '类型': 'type',
      '分类': 'category', '类别': 'category', '标签': 'tag', '级别': 'level',
      '等级': 'level', '优先级': 'priority', '排序': 'sort', '顺序': 'order',
      '序号': 'seq', '索引': 'index', '编号': 'no', '编码': 'code', '代码': 'code',
      '标识': 'id', '主键': 'id', '键': 'key', '值': 'value', '字段': 'field',
      '属性': 'property', '参数': 'param', '配置': 'config', '设置': 'setting',
      '选项': 'option', '开关': 'switch', '标志': 'flag', '标记': 'mark',
      '版本': 'version', '环境': 'env', '模块': 'module', '组件': 'component',
      '插件': 'plugin', '服务': 'service', '接口': 'api', '方法': 'method',
      '函数': 'func', '类': 'class', '对象': 'object', '数组': 'array',
      '集合': 'set', '映射': 'map', '字典': 'dict', '队列': 'queue',
      '栈': 'stack', '列表': 'list', '表格': 'table', '树': 'tree',
      '图': 'graph', '节点': 'node', '边': 'edge', '路径': 'path',
      '文件': 'file', '目录': 'dir', '文件夹': 'folder', '图片': 'image',
      '图像': 'image', '视频': 'video', '音频': 'audio', '文档': 'doc',
      '记录': 'record', '条目': 'item', '明细': 'detail', '行': 'row',
      '列': 'column', '页': 'page', '分页': 'page', '总数': 'total',
      '数量': 'count', '个数': 'count', '长度': 'length', '大小': 'size',
      '宽度': 'width', '高度': 'height', '时间': 'time', '日期': 'date',
      '年份': 'year', '月份': 'month', '天': 'day', '小时': 'hour',
      '分钟': 'minute', '秒': 'second', '开始': 'begin', '结束': 'end',
      '结果': 'result', '数据': 'data', '数据库': 'db', '缓存': 'cache',
      '日志': 'log', '错误': 'error', '异常': 'exception', '消息': 'message',
      '通知': 'notice', '提示': 'tip', '警告': 'warn', '成功': 'success',
      '失败': 'fail', '超时': 'timeout', '重试': 'retry', '连接': 'connection',
      '会话': 'session', '任务': 'task', '作业': 'job', '计划': 'plan',
      '进度': 'progress', '线程': 'thread', '进程': 'process', '内存': 'memory',
      '磁盘': 'disk', '网络': 'network', '端口': 'port', '协议': 'protocol',
      '域名': 'domain', '路由': 'route', '链接': 'link', '地址栏': 'address bar',
      '令牌': 'token', '密钥': 'secret', '签名': 'sign', '加密': 'encrypt',
      '解密': 'decrypt', '哈希': 'hash', '流量': 'traffic', '带宽': 'bandwidth',
      '指标': 'metric', '监控': 'monitor', '报表': 'report', '统计': 'stat',
      '图表': 'chart', '汇总': 'summary', '摘要': 'summary', '详情': 'detail',
      '简介': 'intro', '说明': 'description', '原因': 'reason', '来源': 'source',
      '目标': 'target', '范围': 'range', '区间': 'range', '限制': 'limit',
      '规则': 'rule', '策略': 'policy', '模板': 'template', '样式': 'style',
      '主题': 'theme', '字体': 'font', '颜色': 'color', '背景': 'background',
      '布局': 'layout', '页面': 'page', '视图': 'view', '窗口': 'window',
      '弹窗': 'dialog', '菜单': 'menu', '按钮': 'button', '表单': 'form',
      '输入框': 'input', '输入': 'input', '输出': 'output', '文本': 'text',
      '字符串': 'string', '数字': 'number', '布尔': 'boolean', '时间戳': 'timestamp',
      '金额': 'amount', '价格': 'price', '总价': 'total price', '单价': 'unit price',
      '折扣': 'discount', '汇率': 'rate', '比例': 'ratio', '百分比': 'percent',
      '库存': 'stock', '重量': 'weight', '体积': 'volume', '单位': 'unit',

      // ── commerce ───────────────────────────────────────────────────────────
      '订单': 'order', '订单号': 'order no', '商品': 'product', '产品': 'product',
      '货物': 'goods', '购物': 'shopping', '购物车': 'cart', '支付': 'pay', '付款': 'payment',
      '退款': 'refund', '优惠券': 'coupon', '积分': 'credit', '余额': 'balance',
      '流水': 'bill', '账单': 'bill', '发票': 'invoice', '合同': 'contract',
      '仓库': 'warehouse', '发货': 'ship', '收货': 'receipt', '物流': 'logistics',
      '快递': 'express', '运费': 'freight', '结算': 'settle', '对账': 'reconcile',
      '审批': 'approval', '审核': 'review', '流程': 'flow', '工单': 'ticket',
      '考勤': 'attendance', '请假': 'leave', '报销': 'expense', '工资': 'salary',

      // ── verbs ──────────────────────────────────────────────────────────────
      '创建': 'create', '新建': 'create', '新增': 'add', '添加': 'add',
      '增加': 'add', '更新': 'update', '修改': 'modify', '编辑': 'edit',
      '删除': 'delete', '移除': 'remove', '清空': 'clear', '插入': 'insert',
      '保存': 'save', '提交': 'submit', '取消': 'cancel', '确认': 'confirm',
      '校验': 'validate', '验证': 'verify', '检查': 'check', '检测': 'detect',
      '登录': 'login', '登出': 'logout', '注册': 'register', '注销': 'unregister',
      '退出': 'exit', '重置': 'reset', '刷新': 'refresh', '加载': 'load',
      '下载': 'download', '上传': 'upload', '导入': 'import', '导出': 'export',
      '发送': 'send', '接收': 'receive', '推送': 'push', '拉取': 'pull',
      '请求': 'request', '响应': 'response', '返回': 'return', '调用': 'invoke',
      '执行': 'execute', '运行': 'run', '启动': 'start', '停止': 'stop',
      '暂停': 'pause', '恢复': 'resume', '重启': 'restart', '打开': 'open',
      '获取': 'get', '取得': 'get', '读取': 'read', '写入': 'write', '设定': 'set',
      '关闭': 'close', '搜索': 'search', '查询': 'query', '检索': 'search',
      '过滤': 'filter', '筛选': 'filter', '分组': 'group', '聚合': 'aggregate',
      '合并': 'merge', '拆分': 'split', '复制': 'copy', '粘贴': 'paste',
      '移动': 'move', '重命名': 'rename', '转换': 'convert', '格式化': 'format',
      '解析': 'parse', '序列化': 'serialize', '反序列化': 'deserialize',
      '绑定': 'bind', '解绑': 'unbind', '初始化': 'init', '销毁': 'destroy',
      '同步': 'sync', '异步': 'async', '等待': 'wait', '轮询': 'poll',
      '订阅': 'subscribe', '发布': 'publish', '监听': 'listen', '触发': 'trigger',
      '回滚': 'rollback', '备份': 'backup', '迁移': 'migrate', '部署': 'deploy',
      '构建': 'build', '编译': 'compile', '打包': 'bundle', '安装': 'install',
      '卸载': 'uninstall', '升级': 'upgrade', '测试': 'test', '调试': 'debug',
      '修复': 'fix', '优化': 'optimize', '统计接口': 'stat api',

      // ── qualifiers ─────────────────────────────────────────────────────────
      '全部': 'all', '所有': 'all', '当前': 'current', '默认': 'default',
      '最新': 'latest', '最近': 'recent', '历史': 'history', '有效': 'valid',
      '无效': 'invalid', '启用': 'enable', '禁用': 'disable', '可用': 'available',
      '不可用': 'unavailable', '在线': 'online', '离线': 'offline',
      '公开': 'public', '私有': 'private', '内部': 'internal', '外部': 'external',
      '主要': 'main', '次要': 'minor', '详细': 'detail', '简单': 'simple',
      '复杂': 'complex', '快速': 'fast', '慢速': 'slow', '临时': 'temp',
      '永久': 'permanent', '固定': 'fixed', '动态': 'dynamic', '静态': 'static',
      '成功数': 'success count', '总数汇总': 'total summary',
      '按月': 'monthly', '按天': 'daily', '按年': 'yearly', '按页': 'paged',

      // ── single characters used on their own ────────────────────────────────
      '名': 'name', '值列表': 'value list', '号': 'no', '码': 'code',
      '量': 'amount', '数': 'count', '率': 'rate', '表': 'table',
      '库': 'db', '端': 'end', '层': 'layer', '块': 'block', '组': 'group',
      '项': 'item', '条': 'item', '张': 'sheet', '份': 'copy', '次': 'times',
      '位': 'bit', '秒数': 'seconds', '天数': 'days', '月数': 'months',
    };
    //#endregion

    //#region seed glossary
    /**
     * Starter terms copied into the custom glossary on first run.
     *
     * These are domain words the built-in dictionary deliberately leaves out —
     * they are either company-specific or too narrow for a general developer
     * dictionary — so a developer usually ends up adding them by hand. Seeding
     * them gives the editor something real to edit instead of an empty box, and
     * keeps them in the vocabulary the panel says wins over the built-in one.
     *
     * Two invariants keep seeding boring:
     * - No key appears in {@link DICT}; a seed may only add coverage, never
     *   shadow a shipped entry or change an existing segmentation.
     * - Seeding happens exactly once per browser, marked by
     *   {@link SEEDED_KEY}. A developer who clears the glossary is not
     *   re-seeded on the next load.
     */
    const SEED_GLOSSARY = {
      // ── business / growth ──────────────────────────────────────────────────
      '门店': 'store', '渠道': 'channel', '分销': 'distribution', '佣金': 'commission',
      '提现': 'withdraw', '充值': 'recharge', '续费': 'renew', '试用': 'trial',
      '退订': 'unsubscribe', '召回': 'recall', '裂变': 'referral', '拼团': 'group buy',
      '秒杀': 'flash sale', '预售': 'presale', '尾款': 'balance', '定金': 'deposit',
      '核销': 'redeem', '核销码': 'redeem code', '签到': 'check in',
      '排行榜': 'ranking', '勋章': 'medal', '会员等级': 'member level',
      '用户画像': 'user profile', '标签体系': 'tag system', '人群包': 'audience',
      '投放': 'delivery', '曝光': 'impression', '点击率': 'click rate',
      '转化率': 'convert rate', '留存率': 'retention rate', '留存': 'retention',
      '转化': 'convert', '复购': 'repurchase', '客单价': 'order value',
      '日活': 'daily active', '月活': 'monthly active', '新增用户': 'new user',
      '沉默用户': 'silent user', '流失': 'churn', '唤醒': 'wake up', '触达': 'reach',
      '站内信': 'inbox message', '看板': 'dashboard', '漏斗': 'funnel', '埋点': 'track',

      // ── operations / order fulfilment ──────────────────────────────────────
      '退货': 'return goods', '换货': 'exchange goods', '售后': 'after sale',
      '质检': 'quality check', '入库': 'inbound', '出库': 'outbound',
      '盘点': 'stocktaking', '调拨': 'transfer', '批次': 'batch', '效期': 'expiry',
      '序列号': 'serial no', '条码': 'barcode', '二维码': 'qrcode', '扫码': 'scan code',
      '提货': 'pickup', '自提': 'self pickup', '配送': 'delivery', '骑手': 'rider',
      '运单': 'waybill', '承运商': 'carrier', '揽收': 'collect', '签收': 'sign',
      '拒收': 'reject', '保价': 'insure', '商户': 'merchant', '清算': 'clearing',
      '分账': 'split account', '结算周期': 'settle cycle', '账单周期': 'bill cycle',
      '回款': 'collection', '应收账款': 'receivable', '应付账款': 'payable',
      '发票抬头': 'invoice title', '税率': 'tax rate', '对账文件': 'reconcile file',
      '指标口径': 'metric standard', '值班': 'on duty', '巡检': 'inspection',
      '告警': 'alert', '根因': 'root cause', '复盘': 'retrospective', '预案': 'playbook',
      '容量': 'capacity', '水位': 'water level', '压测': 'stress test',

      // ── architecture / backend ─────────────────────────────────────────────
      '中间件': 'middleware', '网关': 'gateway', '反向代理': 'reverse proxy',
      '负载均衡': 'load balance', '健康检查': 'health check', '优雅停机': 'graceful stop',
      '幂等': 'idempotent', '幂等键': 'idempotent key', '兜底': 'fallback',
      '熔断': 'circuit breaker', '限流': 'rate limit', '降级': 'degrade',
      '令牌桶': 'token bucket', '滑动窗口': 'sliding window', '布隆过滤器': 'bloom filter',
      '环形缓冲': 'ring buffer', '背压': 'back pressure', '连接池': 'connection pool',
      '线程池': 'thread pool', '主从': 'master slave', '分库分表': 'shard',
      '读写分离': 'read write split', '容灾': 'disaster recovery', '多活': 'multi active',
      '死信': 'dead letter', '长轮询': 'long poll', '心跳': 'heartbeat',
      '握手': 'handshake', '调用链': 'call chain', '链路': 'trace link',
      '离线任务': 'offline job', '实时任务': 'realtime job', '数据仓库': 'data warehouse',
      '宽表': 'wide table', '事实表': 'fact table', '维度表': 'dimension table',
      '灰度': 'gray', '白名单': 'whitelist', '黑名单': 'blacklist', '脱敏': 'desensitize',
      '水印': 'watermark', '归档': 'archive', '快照': 'snapshot', '阈值': 'threshold',

      // ── frontend ───────────────────────────────────────────────────────────
      '断言': 'assert', '防抖': 'debounce', '节流': 'throttle',
      '虚拟列表': 'virtual list', '懒加载': 'lazy load', '骨架屏': 'skeleton',
      '水合': 'hydrate', '预渲染': 'prerender', '国际化': 'i18n',
    };
    //#endregion

    //#region tokenizer
    /** Dictionary keys, longest first, so greedy matching prefers `购物车`. */
    const DICT_KEYS = Object.keys(DICT).sort((left, right) => right.length - left.length);
    /**
     * Longest key the built-in dictionary can match. The custom glossary may
     * hold longer keys, so {@link tokenize} widens the window to the glossary's
     * own maximum: a bound computed from `DICT` alone would make a long custom
     * entry unreachable.
     */
    const MAX_KEY = DICT_KEYS.reduce((longest, key) => Math.max(longest, key.length), 1);

    /** True for a CJK ideograph or a CJK-adjacent punctuation-ish char. */
    function isHan(char) {
      return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
    }

    /** True for a latin letter or digit. */
    function isLatin(char) {
      return /[A-Za-z0-9]/.test(char);
    }

    /**
     * Fold words into a camelCase identifier.
     * @param words - lowercase latin words.
     * @returns the identifier, or an empty string when nothing usable remains.
     */
    function camelCase(words) {
      const cleaned = words
        .map((word) => String(word).replace(/[^A-Za-z0-9]/g, ''))
        .filter((word) => word.length > 0);
      if (cleaned.length === 0) return '';
      return cleaned
        .map((word, index) => (index === 0
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join('');
    }

    /**
     * Split one dictionary value into its identifier words.
     * @param value - the English value stored in the dictionary.
     * @returns the words it contributes.
     */
    function wordsOf(value) {
      return value.split(/\s+/).filter((word) => word.length > 0);
    }

    /**
     * Tokenize a mixed Chinese/latin phrase.
     *
     * Han spans are segmented by dynamic programming: the segmentation that
     * covers the most characters with dictionary entries wins, so `用户名称`
     * becomes `用户` + `名称` rather than the longer `用户名` plus a stranded
     * `称`. Ties break toward fewer tokens. The custom glossary is consulted
     * first, so a user override beats a built-in entry. Latin runs pass through
     * verbatim. Han characters no entry covers are reported as unknown, which
     * is what routes the phrase to the model.
     *
     * @param text - the raw phrase.
     * @param glossary - merged custom glossary, Chinese key → English value.
     * @returns ordered words plus the uncovered characters.
     */
    function tokenize(text, glossary) {
      const words = [];
      const unknown = [];
      const source = text.normalize('NFKC').trim();
      /** English value of a segment, or undefined when nothing covers it. */
      const lookup = (segment) => {
        const custom = glossary[segment];
        if (custom !== undefined) return custom;
        return DICT[segment];
      };
      // A custom entry may be longer than any built-in key, so the window
      // covers the glossary's own longest key too.
      let window = MAX_KEY;
      for (const key of Object.keys(glossary)) {
        if (key.length > window) window = key.length;
      }
      let index = 0;
      while (index < source.length) {
        const char = source[index];
        if (isLatin(char)) {
          let run = '';
          while (index < source.length && (isLatin(source[index]) || source[index] === '_' || source[index] === '-')) {
            run += source[index];
            index += 1;
          }
          const parts = run.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/);
          for (const part of parts) if (part.length > 0) words.push(part.toLowerCase());
          continue;
        }
        if (!isHan(char)) {
          index += 1;
          continue;
        }
        // One maximal Han run, then segment that run.
        let end = index;
        while (end < source.length && (isHan(source[end]) || STOPWORDS.has(source[end]))) end += 1;
        const run = source.slice(index, end);
        index = end;
        const length = run.length;
        // best[i] = fewest unknown characters covering run.slice(i) …
        const best = new Array(length + 1);
        // steps[i] = how many characters the chosen segment at i spans.
        const steps = new Array(length + 1).fill(1);
        best[length] = 0;
        for (let at = length - 1; at >= 0; at -= 1) {
          const one = run[at];
          // A single uncovered character costs one unknown.
          best[at] = best[at + 1] + (STOPWORDS.has(one) ? 0 : 1);
          steps[at] = 1;
          for (let span = 2; span <= Math.min(window, length - at); span += 1) {
            const candidate = run.slice(at, at + span);
            if (STOPWORDS.has(candidate)) {
              if (best[at + span] < best[at]) {
                best[at] = best[at + span];
                steps[at] = span;
              }
              continue;
            }
            if (lookup(candidate) === undefined) continue;
            // A custom entry beats an equally complete built-in segmentation:
            // `新增用户=新 user` is what the developer asked for, even when
            // `新增`+`用户` also covers every character.
            if (glossary[candidate] !== undefined) {
              if (best[at + span] <= best[at]) {
                best[at] = best[at + span];
                steps[at] = span;
              }
              continue;
            }
            if (best[at + span] < best[at]) {
              best[at] = best[at + span];
              steps[at] = span;
            }
          }
        }
        for (let at = 0; at < length;) {
          const span = steps[at];
          const segment = run.slice(at, at + span);
          at += span;
          if (STOPWORDS.has(segment)) continue;
          const value = lookup(segment);
          if (value === undefined) {
            for (const missing of segment) unknown.push(missing);
            continue;
          }
          for (const word of wordsOf(value)) words.push(word.toLowerCase());
        }
      }
      return { words, unknown };
    }
    //#endregion

    //#region glossary storage
    /** The browser's localStorage, or undefined where the page withholds it. */
    function browserStorage() {
      try {
        const storage = window.localStorage;
        return storage === undefined || storage === null ? undefined : storage;
      } catch {
        return undefined;
      }
    }

    /**
     * Parse the `中文=english` glossary text the panel edits.
     * @param text - one entry per line, `=` or `:` separated.
     * @returns Chinese key → English value.
     */
    function parseGlossaryText(text) {
      const entries = {};
      for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) continue;
        const separator = line.search(/[=:：]/);
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key.length === 0 || value.length === 0) continue;
        entries[key] = value;
      }
      return entries;
    }

    /** Render a glossary map back into editable text, sorted by key. */
    function formatGlossaryText(glossary) {
      return Object.keys(glossary)
        .sort()
        .map((key) => `${key}=${glossary[key]}`)
        .join('\n');
    }

    /**
     * Read the stored glossary.
     * @param storage - the storage to read, when available.
     * @returns Chinese key → English value.
     */
    function readGlossary(storage) {
      if (storage === undefined) return {};
      try {
        const raw = storage.getItem(GLOSSARY_KEY);
        if (raw === null || raw.length === 0) return {};
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && parsed.entries !== null
          && typeof parsed.entries === 'object' ? parsed.entries : {};
      } catch {
        return {};
      }
    }

    /**
     * Persist the glossary under the plugin-owned key.
     * @param storage - the storage to write, when available.
     * @param glossary - Chinese key → English value.
     */
    function writeGlossary(storage, glossary) {
      if (storage === undefined) return;
      try {
        storage.setItem(GLOSSARY_KEY, JSON.stringify({ version: 1, entries: glossary }));
      } catch {
        /* A full or read-only store must not break the panel. */
      }
    }

    /**
     * Read the glossary the panel should start with, seeding the starter terms
     * the first time this browser ever runs the plugin.
     *
     * The seed is written once and never re-applied: once {@link SEEDED_KEY} is
     * set, an emptied glossary stays empty. A stored glossary always wins over
     * the seed, including one the developer deliberately trimmed.
     *
     * @param storage - the storage to read and seed, when available.
     * @returns Chinese key → English value.
     */
    function loadGlossary(storage) {
      if (storage === undefined) return { ...SEED_GLOSSARY };
      let alreadySeeded = false;
      try {
        alreadySeeded = storage.getItem(SEEDED_KEY) !== null;
      } catch {
        /* An unreadable flag means we cannot tell; treat it as unseeded. */
      }
      const stored = readGlossary(storage);
      const hasStored = Object.keys(stored).length > 0;
      if (alreadySeeded) return hasStored ? stored : {};
      // First run: merge the seed under anything already stored, then record
      // the flag even if the write below is refused, so the seed cannot be
      // applied twice across reloads.
      const merged = { ...SEED_GLOSSARY, ...stored };
      writeGlossary(storage, merged);
      try {
        storage.setItem(SEEDED_KEY, '1');
      } catch {
        /* Seed applied in memory; the next load retries harmlessly. */
      }
      return merged;
    }
    //#endregion

    //#region translation
    /**
     * Translate one phrase from the dictionary and glossary alone.
     * @param text - the raw phrase.
     * @param glossary - merged custom glossary.
     * @returns the identifier, the words behind it, and any uncovered characters.
     */
    function translateLocally(text, glossary) {
      const { words, unknown } = tokenize(text, glossary);
      return { identifier: camelCase(words), words, unknown };
    }

    /**
     * Ask the Host to gloss a phrase the dictionary could not cover in full.
     * @param text - the phrase.
     * @param signal - cancellation.
     * @returns the model answer.
     */
    async function translateRemotely(text, signal) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-naming-translator': '1' },
        body: JSON.stringify({ text }),
        signal,
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('The Host route returned no JSON');
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const message = payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
          ? payload.message
          : `Host route answered ${response.status}`;
        throw new Error(message);
      }
      if (typeof payload.identifier !== 'string' || payload.identifier.length === 0) {
        throw new Error('The model returned no usable identifier');
      }
      return {
        identifier: payload.identifier,
        words: Array.isArray(payload.words) ? payload.words : [],
        cached: payload.cached === true,
      };
    }
    //#endregion

    //#region styles
    /**
     * Tool-row control metrics plus the popover, all on theme tokens.
     *
     * Two scopes, because the popover portals to `document.body` to escape the
     * composer's clipping box: the trigger is styled under
     * `[data-naming-translator]`, and the popover under
     * `[data-naming-translator-panel]`, which travels with the portaled node.
     */
    const CSS = `
[data-naming-translator]{display:inline-flex}
[data-naming-translator] .dnt-trigger{display:inline-flex;flex:none;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 8px;border:none;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;cursor:pointer}
[data-naming-translator] .dnt-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
[data-naming-translator] .dnt-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
[data-naming-translator] .dnt-triggerLabel{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-naming-translator-panel]{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:340px;max-width:calc(100vw - 24px);padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font-size:13px;line-height:20px}
[data-naming-translator-panel] .dnt-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
[data-naming-translator-panel] .dnt-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
[data-naming-translator-panel] .dnt-close{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;border-radius:999px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
[data-naming-translator-panel] .dnt-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
[data-naming-translator-panel] .dnt-input{box-sizing:border-box;width:100%;min-height:30px;padding:5px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;outline:none;resize:none}
[data-naming-translator-panel] .dnt-input:focus{border-color:var(--dsw-alias-state-business-primary)}
[data-naming-translator-panel] .dnt-output{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-height:30px;padding:5px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base)}
[data-naming-translator-panel] .dnt-identifier{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:13px}
[data-naming-translator-panel] .dnt-identifier[data-empty="true"]{color:var(--dsw-alias-label-caption)}
[data-naming-translator-panel] .dnt-badge{flex:none;padding:0 5px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
[data-naming-translator-panel] .dnt-badge[data-src="model"]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-color)}
[data-naming-translator-panel] .dnt-badge[data-src="custom"]{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-on-color)}
[data-naming-translator-panel] .dnt-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[data-naming-translator-panel] .dnt-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
[data-naming-translator-panel] .dnt-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
[data-naming-translator-panel] .dnt-btn:disabled{opacity:.5;cursor:default}
[data-naming-translator-panel] .dnt-btn[data-primary="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-on-color)}
[data-naming-translator-panel] .dnt-note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
[data-naming-translator-panel] .dnt-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
[data-naming-translator-panel] .dnt-history{display:flex;flex-wrap:wrap;gap:6px}
[data-naming-translator-panel] .dnt-chip{padding:1px 7px;border:none;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
[data-naming-translator-panel] .dnt-chip:hover{color:var(--dsw-alias-label-primary)}
[data-naming-translator-panel] .dnt-glossary{box-sizing:border-box;width:100%;min-height:64px;padding:5px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono);font-size:12px;line-height:18px;outline:none;resize:vertical}
[data-naming-translator-panel] .dnt-glossary:focus{border-color:var(--dsw-alias-state-business-primary)}
`.trim();
    //#endregion

    //#region icons
    /** 16px icon frame; strokes and fills come from `currentColor`. */
    function Icon(props) {
      const children = props.children === undefined || props.children === null
        ? []
        : [].concat(props.children);
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block' },
      }, ...children);
    }

    /** A brace pair around a dot: "identifier". */
    const GLYPH = [
      h('path', {
        key: 'l',
        d: 'M5.6 2.6c-1.5 0-1.9.7-1.9 2v1.5c0 .8-.5 1.3-1.3 1.4.8.1 1.3.6 1.3 1.4V11c0 1.3.4 2 1.9 2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('path', {
        key: 'r',
        d: 'M10.4 2.6c1.5 0 1.9.7 1.9 2v1.5c0 .8.5 1.3 1.3 1.4-.8.1-1.3.6-1.3 1.4V11c0 1.3-.4 2-1.9 2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { key: 'd', cx: 8, cy: 8, r: 1.3, fill: 'currentColor' }),
    ];

    const CLOSE_PATHS = h('path', {
      d: 'M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
    });
    //#endregion

    //#region component
    /** Small icon button; matches the tool row's own controls. */
    function IconButton(props) {
      const buttonProps = {
        type: 'button',
        className: 'dnt-close',
        onClick: props.onClick,
        title: props.label,
        'aria-label': props.label,
      };
      return h('button', buttonProps, props.children);
    }

    /**
     * The tool-row control and its popover.
     *
     * The control is permanently visible; the popover carries the input, the
     * identifier, the copy/insert actions, the recent phrases, and the custom
     * glossary editor. All state lives in this component: it is not
     * session-scoped, so switching sessions keeps the last phrase.
     */
    function NamingTranslator(props) {
      const t = props.t;
      const inputActions = props.inputActions;
      const storage = browserStorage();

      const [open, setOpen] = React.useState(false);
      const [text, setText] = React.useState('');
      const [entry, setEntry] = React.useState(null);
      const [source, setSource] = React.useState('dict');
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [history, setHistory] = React.useState([]);
      const [glossary, setGlossary] = React.useState(() => loadGlossary(storage));
      const [glossaryOpen, setGlossaryOpen] = React.useState(false);
      // Both initializers read through the same loader; the seed is applied once
      // and recorded, so the second read sees exactly what the first stored.
      const [glossaryText, setGlossaryText] = React.useState(() => formatGlossaryText(loadGlossary(storage)));
      const [copied, setCopied] = React.useState(false);
      const [placement, setPlacement] = React.useState({ left: 12, top: 12 });
      const rootRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const abortRef = React.useRef(null);

      /**
       * Keep the popover beside the control: above it when there is room,
       * otherwise below, and always inside the viewport on both axes.
       */
      const place = React.useCallback(() => {
        const node = rootRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        const width = 340;
        const gap = 8;
        const left = Math.min(Math.max(gap, rect.left), Math.max(gap, window.innerWidth - width - gap));
        // The composer sits near the bottom, so "above" is the usual choice;
        // a short viewport flips it under the control instead.
        const above = rect.top > Math.min(320, window.innerHeight * 0.55);
        setPlacement({
          left,
          top: above ? rect.top - gap : rect.bottom + gap,
          flip: !above,
        });
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        place();
        const onPointerDown = (event) => {
          const node = rootRef.current;
          if (node !== null && node.contains(event.target)) return;
          const panel = document.querySelector('[data-naming-translator-panel]');
          if (panel !== null && panel.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open, place]);

      React.useEffect(() => {
        if (!open) return undefined;
        const handle = window.setTimeout(() => {
          if (inputRef.current !== null) inputRef.current.focus();
        }, 0);
        return () => window.clearTimeout(handle);
      }, [open]);

      React.useEffect(() => () => {
        if (abortRef.current !== null) abortRef.current.abort();
      }, []);

      /** Translate `value`, dictionary first, model only on an uncovered phrase. */
      const translate = React.useCallback(async (value) => {
        const phrase = String(value).trim();
        if (phrase.length === 0) {
          setEntry(null);
          setError('');
          return;
        }
        const local = translateLocally(phrase, glossary);
        if (local.unknown.length === 0 && local.identifier.length > 0) {
          setEntry({ identifier: local.identifier, words: local.words });
          setSource(glossaryHasHit(phrase, glossary) ? 'custom' : 'dict');
          setError('');
          return;
        }
        if (typeof fetch !== 'function') {
          if (local.identifier.length > 0) {
            setEntry({ identifier: local.identifier, words: local.words });
            setSource('dict');
          }
          setError(t('panel.noModel'));
          return;
        }
        if (abortRef.current !== null) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        setError('');
        try {
          const remote = await translateRemotely(phrase, controller.signal);
          setEntry({ identifier: remote.identifier, words: remote.words });
          setSource('model');
          setError('');
        } catch (failure) {
          if (failure.name === 'AbortError') return;
          if (local.identifier.length > 0) {
            setEntry({ identifier: local.identifier, words: local.words });
            setSource('dict');
          } else {
            setEntry(null);
          }
          setError(failure.message);
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setBusy(false);
        }
      }, [glossary, t]);

      /** True when any token of `phrase` came from the custom glossary. */
      function glossaryHasHit(phrase, glossaryMap) {
        for (const key of Object.keys(glossaryMap)) {
          if (phrase.includes(key)) return true;
        }
        return false;
      }

      /** Remember one accepted phrase so it can be re-applied in one click. */
      const remember = React.useCallback((phrase, identifier) => {
        if (identifier.length === 0) return;
        setHistory((previous) => {
          const next = [{ phrase, identifier }].concat(previous.filter((row) => row.phrase !== phrase));
          return next.slice(0, HISTORY_LIMIT);
        });
      }, []);

      const onChangeText = (event) => {
        const value = event.target.value.slice(0, MAX_INPUT);
        setText(value);
        setCopied(false);
        translate(value);
      };

      const onKeyDownInput = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (entry !== null) remember(text.trim(), entry.identifier);
        }
      };

      const copy = async () => {
        if (entry === null) return;
        try {
          await navigator.clipboard.writeText(entry.identifier);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setError(t('panel.copyFailed'));
        }
        remember(text.trim(), entry.identifier);
      };

      /** Insert the identifier at the editor caret, preserving the draft. */
      const insert = () => {
        if (entry === null) return;
        remember(text.trim(), entry.identifier);
        if (inputActions === undefined || inputActions === null) return;
        try {
          const span = inputActions.captureInsertion();
          if (inputActions.insertText(entry.identifier, span)) setOpen(false);
        } catch {
          /* A locked editor refuses the insert; the identifier stays copyable. */
        }
      };

      const saveGlossary = () => {
        const parsed = parseGlossaryText(glossaryText);
        setGlossary(parsed);
        writeGlossary(storage, parsed);
        setGlossaryText(formatGlossaryText(parsed));
        if (text.trim().length > 0) translate(text);
      };

      const clearGlossary = () => {
        setGlossary({});
        writeGlossary(storage, {});
        setGlossaryText('');
        if (text.trim().length > 0) translate(text);
      };

      /** Put the starter terms back, keeping nothing else. */
      const restoreSeeds = () => {
        const seeded = { ...SEED_GLOSSARY };
        setGlossary(seeded);
        writeGlossary(storage, seeded);
        setGlossaryText(formatGlossaryText(seeded));
        if (text.trim().length > 0) translate(text);
      };

      const badgeKey = source === 'model' ? 'panel.sourceModel' : source === 'custom' ? 'panel.sourceCustom' : 'panel.sourceDict';
      const placeholder = t('panel.placeholder');
      const triggerLabel = entry === null ? t('trigger.label') : entry.identifier;

      const output = h('div', { className: 'dnt-output' },
        h('span', {
          className: 'dnt-identifier',
          'data-empty': entry === null ? 'true' : 'false',
          title: entry === null ? undefined : entry.identifier,
        }, entry === null ? (busy ? t('panel.working') : t('panel.empty')) : entry.identifier),
        entry === null ? null : h('span', { className: 'dnt-badge', 'data-src': source }, t(badgeKey)));

      const actions = h('div', { className: 'dnt-row' },
        h('button', {
          type: 'button',
          className: 'dnt-btn',
          'data-primary': 'true',
          disabled: entry === null,
          onClick: copy,
        }, copied ? t('panel.copied') : t('panel.copy')),
        h('button', {
          type: 'button',
          className: 'dnt-btn',
          disabled: entry === null,
          onClick: insert,
        }, t('panel.insert')),
        h('button', {
          type: 'button',
          className: 'dnt-btn',
          onClick: () => setGlossaryOpen((value) => !value),
        }, t('panel.glossary')));

      const note = error.length > 0
        ? h('div', { className: 'dnt-note', 'data-tone': 'error', role: 'alert' }, error)
        : entry !== null && entry.words.length > 1
          ? h('div', { className: 'dnt-note' }, entry.words.join(' + '))
          : null;

      const recent = history.length === 0 ? null : h('div', { className: 'dnt-history' },
        ...history.map((row) => h('button', {
          key: row.phrase,
          type: 'button',
          className: 'dnt-chip',
          title: row.phrase,
          onClick: () => {
            setText(row.phrase);
            translate(row.phrase);
          },
        }, row.identifier)));

      const glossaryEditor = glossaryOpen ? h('div', null,
        h('textarea', {
          className: 'dnt-glossary',
          spellCheck: false,
          value: glossaryText,
          placeholder: t('panel.glossaryPlaceholder'),
          onChange: (event) => setGlossaryText(event.target.value),
        }),
        h('div', { className: 'dnt-row', style: { marginTop: '6px' } },
          h('button', { type: 'button', className: 'dnt-btn', 'data-primary': 'true', onClick: saveGlossary },
            t('panel.glossarySave')),
          h('button', { type: 'button', className: 'dnt-btn', onClick: restoreSeeds },
            t('panel.glossaryRestore')),
          h('button', { type: 'button', className: 'dnt-btn', onClick: clearGlossary },
            t('panel.glossaryClear'))),
        h('div', { className: 'dnt-note' },
          t('panel.glossaryHint', { count: String(Object.keys(glossary).length) }))) : null;

      const body = h('div', {
        className: 'dnt-panel',
        'data-naming-translator-panel': '',
        'data-flip': placement.flip ? 'true' : 'false',
        role: 'dialog',
        'aria-label': t('panel.title'),
        style: {
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          // Anchored bottom-left to the control when above it, top-left when flipped.
          transform: placement.flip ? 'none' : 'translateY(-100%)',
        },
      },
        h('div', { className: 'dnt-head' },
          h('span', { className: 'dnt-title' }, t('panel.title')),
          h(IconButton, { label: t('panel.close'), onClick: () => setOpen(false) }, h(Icon, null, CLOSE_PATHS))),
        h('textarea', {
          ref: inputRef,
          className: 'dnt-input',
          rows: 1,
          spellCheck: false,
          value: text,
          maxLength: MAX_INPUT,
          placeholder,
          'aria-label': t('panel.inputLabel'),
          onChange: onChangeText,
          onKeyDown: onKeyDownInput,
        }),
        output,
        actions,
        note,
        recent,
        glossaryEditor);

      return h('div', { 'data-naming-translator': '', ref: rootRef },
        h('button', {
          type: 'button',
          className: 'dnt-trigger',
          'aria-expanded': open ? 'true' : 'false',
          'aria-haspopup': 'dialog',
          title: t('trigger.title'),
          onClick: () => setOpen((value) => {
            if (!value) place();
            return !value;
          }),
        },
          h(Icon, null, GLYPH),
          h('span', { className: 'dnt-triggerLabel' }, triggerLabel)),
        open
          ? (createPortal !== null
            ? createPortal(body, document.body)
            : h('div', { style: { position: 'absolute', left: 0, bottom: '100%' } }, body))
          : null);
    }
    //#endregion

    //#region dictionaries
    /** Simplified Chinese dictionary; the key set source of truth. */
    const zh = {
      'trigger.label': '命名',
      'trigger.title': '中文变量名 / 方法名翻译（词典优先，查不到时调用模型）',
      'panel.title': '变量名翻译',
      'panel.inputLabel': '中文表述',
      'panel.placeholder': '例如：用户信息 / 订单分页查询',
      'panel.empty': '输入中文即可得到标识符',
      'panel.working': '正在查询模型…',
      'panel.copy': '复制',
      'panel.copied': '已复制',
      'panel.insert': '插入到输入框',
      'panel.glossary': '自定义词典',
      'panel.glossaryPlaceholder': '每行一条：中文=english\n例如：\n门店=store\n渠道=channel',
      'panel.glossarySave': '保存',
      'panel.glossaryRestore': '恢复预置词条',
      'panel.glossaryClear': '清空',
      'panel.glossaryHint': '已预置 {count} 条常用领域词条，可自行增删；自定义词优先于内置词典，只保存在本机。',
      'panel.sourceDict': '词典',
      'panel.sourceModel': '模型',
      'panel.sourceCustom': '自定义',
      'panel.noModel': '当前环境无法调用模型，已按词典给出结果。',
      'panel.copyFailed': '复制失败，请手动选择文本。',
      'panel.close': '关闭',
    };

    /** English dictionary; checked complete against the Chinese key set. */
    const en = {
      'trigger.label': 'Naming',
      'trigger.title': 'Translate Chinese variable and method names (dictionary first, model fallback)',
      'panel.title': 'Name translator',
      'panel.inputLabel': 'Chinese phrase',
      'panel.placeholder': 'For example: 用户信息 / 订单分页查询',
      'panel.empty': 'Type Chinese to get an identifier',
      'panel.working': 'Asking the model…',
      'panel.copy': 'Copy',
      'panel.copied': 'Copied',
      'panel.insert': 'Insert into input',
      'panel.glossary': 'Custom terms',
      'panel.glossaryPlaceholder': 'One per line: 中文=english\nFor example:\n门店=store\n渠道=channel',
      'panel.glossarySave': 'Save',
      'panel.glossaryRestore': 'Restore preloaded terms',
      'panel.glossaryClear': 'Clear',
      'panel.glossaryHint': '{count} common domain terms are preloaded and editable; custom terms win over the built-in dictionary and stay on this machine.',
      'panel.sourceDict': 'Dictionary',
      'panel.sourceModel': 'Model',
      'panel.sourceCustom': 'Custom',
      'panel.noModel': 'No model route is reachable here, so the dictionary answer is shown.',
      'panel.copyFailed': 'Could not copy; select the text manually.',
      'panel.close': 'Close',
    };
    //#endregion

    //#region plugin
    /** Required client services: the slot registry and the locale registry. */
    const inject = ['slots', 'locale'];

    /**
     * Client plugin body: dictionaries, styles, and the single tool-row
     * registration. Every resource is owned by one `ctx.effect`, so disabling
     * or reloading the plugin removes all of them.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'naming-translator: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = PACKAGE_NAME;
        style.dataset.pluginCss = `${PACKAGE_NAME}/client.css`;
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, 'naming-translator: styles');
      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: SLOT_ID,
        order: SLOT_ORDER,
        locale: NS,
      }, NamingTranslator));
    }
    //#endregion

    exports.apply = apply;
    exports.inject = inject;
    exports.NamingTranslator = NamingTranslator;
    exports.tokenize = tokenize;
    exports.camelCase = camelCase;
    exports.translateLocally = translateLocally;
    exports.parseGlossaryText = parseGlossaryText;
    exports.loadGlossary = loadGlossary;
    exports.SEED_GLOSSARY = SEED_GLOSSARY;
    exports.DICT = DICT;
    return module.exports;
  },
});
