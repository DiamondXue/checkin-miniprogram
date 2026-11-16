/**
 * 中国移动 App 每日自动签到脚本（Hamibot / Auto.js）
 *
 * 功能：自动打开中国移动 App → 点击「签到有礼」→ 完成签到 → 返回
 * 适用：安卓手机，需安装 Hamibot 或 Auto.js
 * 调度：在 Hamibot 控制台设置「定时任务」每天自动运行
 *
 * 注意：首次运行请给予「无障碍」和「悬浮窗」权限，并手动测试一次
 */

// ============ 配置区 ============
const CONFIG = {
    APP_PACKAGE: "com.greenpoint.android.mc10086.activity",   // 中国移动 App 包名
    APP_NAME: "中国移动",
    WAIT_TIMEOUT: 15000,        // 单次等待超时（毫秒）
    STEP_INTERVAL: 1500,        // 步骤间默认间隔（毫秒）
    MAX_RETRY: 3,               // 关键步骤最大重试次数
};

// 可能出现的签到按钮文案（按优先级）
const SIGNIN_BTN_TEXTS = ["签到有礼", "立即签到", "签到", "签到领福利", "领流量", "签到领奖"];
// 可能出现的关闭/跳过按钮文案
const CLOSE_TEXTS = ["关闭", "跳过", "我知道了", "知道了", "关闭弹窗", "×", "✕"];

// ============ 工具函数 ============
function log(msg) {
    console.log("[中国移动签到] " + msg);
}

function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { }
}

/** 按文案查找并点击控件（支持 text / desc / id 模糊匹配） */
function findAndClickByText(textList, timeout) {
    timeout = timeout || CONFIG.WAIT_TIMEOUT;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (let i = 0; i < textList.length; i++) {
            const t = textList[i];
            // 优先精确匹配 text
            let node = text(t).findOne(300);
            if (node) {
                log("找到文本控件: " + t);
                if (clickCenter(node)) return true;
            }
            // 匹配 desc
            node = desc(t).findOne(300);
            if (node) {
                log("找到描述控件: " + t);
                if (clickCenter(node)) return true;
            }
            // 模糊匹配 text
            node = textMatches(".*" + t + ".*").findOne(300);
            if (node) {
                log("模糊匹配文本控件: " + t);
                if (clickCenter(node)) return true;
            }
        }
        sleep(500);
    }
    return false;
}

/** 点击控件中心 */
function clickCenter(node) {
    try {
        const b = node.bounds();
        const x = b.left + b.width() / 2;
        const y = b.top + b.height() / 2;
        // 优先用控件 click，失败则用坐标
        if (node.clickable()) {
            if (node.click()) return true;
        }
        return click(x, y);
    } catch (e) {
        log("点击异常: " + e);
        return false;
    }
}

/** 处理可能弹出的广告/活动弹窗 */
function dismissPopups() {
    let handled = false;
    for (let i = 0; i < CLOSE_TEXTS.length; i++) {
        const t = CLOSE_TEXTS[i];
        const node = text(t).findOne(500) || desc(t).findOne(500);
        if (node) {
            log("关闭弹窗: " + t);
            clickCenter(node);
            handled = true;
            sleep(800);
            break;
        }
    }
    // 也尝试点击右上角关闭图标（坐标兜底）
    if (!handled) {
        const w = device.width;
        // 右上角常见关闭按钮区域
        if (click(w - 60, 120)) {
            handled = true;
        }
    }
    return handled;
}

/** 启动 App 并等待首页加载 */
function launchAppAndWait() {
    log("启动 " + CONFIG.APP_NAME + " ...");
    app.launchPackage(CONFIG.APP_PACKAGE);
    // 等待 App 出现
    const deadline = Date.now() + CONFIG.WAIT_TIMEOUT;
    let appeared = false;
    while (Date.now() < deadline) {
        if (currentPackage() === CONFIG.APP_PACKAGE) {
            appeared = true;
            break;
        }
        sleep(500);
    }
    if (!appeared) {
        log("App 启动超时，尝试按名称启动");
        app.launchApp(CONFIG.APP_NAME);
        sleep(3000);
    }
    // 等待首页加载（出现「签到有礼」或搜索框等首页元素）
    log("等待首页加载...");
    const homeDeadline = Date.now() + CONFIG.WAIT_TIMEOUT;
    while (Date.now() < homeDeadline) {
        if (text("签到有礼").exists() || textMatches(".*超值套餐.*").exists() || text("营业厅").exists()) {
            log("首页已加载");
            return true;
        }
        dismissPopups();
        sleep(500);
    }
    log("首页加载等待超时，继续尝试签到");
    return false;
}

/** 进入签到页面 */
function enterSignInPage() {
    log("查找「签到有礼」入口...");
    for (let retry = 0; retry < CONFIG.MAX_RETRY; retry++) {
        // 先处理弹窗
        dismissPopups();
        // 尝试点击「签到有礼」
        if (findAndClickByText(["签到有礼"], 8000)) {
            sleep(CONFIG.STEP_INTERVAL);
            log("已进入签到相关页面");
            return true;
        }
        // 兜底：根据截图，「签到有礼」在首页右上角区域（约 70% 宽，12% 高）
        log("文本查找失败，尝试坐标点击...");
        const w = device.width;
        const h = device.height;
        // 「签到有礼」按钮大致位置（相对坐标）
        const x = Math.floor(w * 0.68);
        const y = Math.floor(h * 0.15);
        log("坐标兜底点击: (" + x + ", " + y + ")");
        click(x, y);
        sleep(2500);
        // 判断是否进入了签到页面
        if (textMatches(".*签到.*").exists() || text("流量").exists() || text("领取").exists()) {
            return true;
        }
        log("第 " + (retry + 1) + " 次尝试失败，重试...");
    }
    return false;
}

/** 执行签到 */
function doSignIn() {
    log("开始签到，查找签到按钮...");
    for (let retry = 0; retry < CONFIG.MAX_RETRY; retry++) {
        dismissPopups();
        // 查找签到按钮
        if (findAndClickByText(SIGNIN_BTN_TEXTS, 8000)) {
            sleep(2000);
            // 签到后可能有弹窗，关闭
            dismissPopups();
            log("签到操作已执行");
            return true;
        }
        // 如果已经签到过，页面会显示「已签到」之类
        if (textMatches(".*已签到.*").exists() || textMatches(".*明日再来.*").exists() || textMatches(".*签到成功.*").exists()) {
            log("今日已签到或签到成功");
            return true;
        }
        log("第 " + (retry + 1) + " 次查找签到按钮失败，重试...");
        sleep(1000);
    }
    return false;
}

// ============ 主流程 ============
function main() {
    log("========== 开始执行签到 ==========");

    // 请求无障碍权限
    if (!auto.service) {
        log("请先开启无障碍服务！");
        toast("请先开启无障碍服务");
        return;
    }

    // 1. 启动 App
    if (!launchAppAndWait()) {
        log("警告：未能确认首页加载，继续尝试");
    }

    // 2. 进入签到页
    if (!enterSignInPage()) {
        log("错误：无法进入签到页面");
        toast("中国移动签到：无法进入签到页面");
        return;
    }

    // 3. 执行签到
    if (!doSignIn()) {
        log("错误：签到失败");
        toast("中国移动签到：签到失败");
        return;
    }

    // 4. 完成
    log("========== 签到流程执行完成 ==========");
    toast("中国移动签到完成");

    // 可选：返回桌面
    sleep(2000);
    home();
}

main();
