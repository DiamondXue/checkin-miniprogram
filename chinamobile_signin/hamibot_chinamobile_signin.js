/**
 * Hamibot 脚本 —— 中国移动 App 每日自动签到
 *
 * 说明：本版本以"能正常运行的基线代码"为准，只做最小改动：
 *   1. 「立即签到」坐标按截屏实测修正为 0.39 / 0.855
 *   2. 去掉等待 H5 文本的 18 秒空等（H5 页面无障碍读不到文字）
 * 不使用 console.show() / captureScreen()，避免因缺少悬浮窗、截图权限导致脚本被终止。
 */

const APP_PACKAGE = "com.greenpoint.android.mc10086.activity";
const APP_NAME = "中国移动";
const TARGET_TEXT = "签到有礼";
const WAIT_TIMEOUT = 15000;
const POLL_INTERVAL = 500;

// 签到按钮：只用精确文案，避免"签到"一词误中标题/日历等元素
const SIGNIN_BTN_TEXT = "立即签到";
// 签到成功判定：不能用"已签到"（日历格子上本来就有），也不能用"已领取"
const SUCCESS_TEXTS = ["签到成功", "明日再来", "领取成功", "签到完成", "今日已签到"];
const CLOSE_TEXTS = ["关闭", "我知道了", "知道了", "跳过", "好的", "确定"];
// 「立即签到」按钮实测位置（按钮中心），按屏幕宽高比例
const BTN_X = 0.39;
const BTN_Y = 0.855;
// 首页「签到有礼」入口兜底坐标
const ENTRY_X = 0.62;
const ENTRY_Y = 0.155;
// 等 H5 页面渲染的时间
const H5_LOAD_WAIT = 6000;

function log(msg) {
    console.log("[中国移动签到] " + msg);
    try { toast(msg); } catch (e) {}
}

function findClickableAncestor(node, maxDepth) {
    maxDepth = maxDepth || 5;
    let cur = node;
    for (let i = 0; i < maxDepth && cur; i++) {
        try {
            if (cur.clickable()) return cur;
            cur = cur.parent();
        } catch (e) { break; }
    }
    return null;
}

function clickNode(node) {
    if (!node) return false;
    try {
        const b = node.bounds();
        const cx = b.centerX();
        const cy = b.centerY();
        log("点击目标坐标: (" + cx + ", " + cy + ")");
        if (node.clickable() && node.click()) {
            log("节点点击成功");
            return true;
        }
        if (click(cx, cy)) {
            log("坐标点击成功");
            return true;
        }
    } catch (e) {
        log("点击异常: " + e);
    }
    return false;
}

function fallbackClickByRatio(ratioX, ratioY) {
    const dw = device.width;
    const dh = device.height;
    const fx = Math.floor(dw * ratioX);
    const fy = Math.floor(dh * ratioY);
    log("比例坐标兜底点击: (" + fx + ", " + fy + ")");
    return click(fx, fy);
}

function waitForText(txt, timeout) {
    timeout = timeout || WAIT_TIMEOUT;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            let node = text(txt).findOne(200);
            if (node) return node;
            node = textMatches(".*" + txt + ".*").findOne(200);
            if (node) return node;
        } catch (e) {}
        sleep(POLL_INTERVAL);
    }
    return null;
}

function isSignedIn() {
    for (let i = 0; i < SUCCESS_TEXTS.length; i++) {
        try {
            if (textMatches(".*" + SUCCESS_TEXTS[i] + ".*").exists()) {
                log("检测到签到结果: " + SUCCESS_TEXTS[i]);
                return true;
            }
        } catch (e) {}
    }
    return false;
}

function dismissPopups() {
    for (let i = 0; i < CLOSE_TEXTS.length; i++) {
        try {
            const node = text(CLOSE_TEXTS[i]).findOne(300) || desc(CLOSE_TEXTS[i]).findOne(300);
            if (node) {
                log("关闭弹窗: " + CLOSE_TEXTS[i]);
                const clickable = findClickableAncestor(node, 3) || node;
                clickNode(clickable);
                sleep(800);
                return true;
            }
        } catch (e) {}
    }
    return false;
}

function clickSignInButton() {
    log("进入签到页，等待 H5 加载 " + (H5_LOAD_WAIT / 1000) + " 秒...");
    sleep(H5_LOAD_WAIT);
    dismissPopups();

    // 1. 先快速试一次文本识别（部分机型 webview 能被读到）
    let clicked = false;
    try {
        const node = text(SIGNIN_BTN_TEXT).findOne(1500);
        if (node) {
            log("找到「立即签到」控件");
            const clickable = findClickableAncestor(node, 5) || node;
            clicked = clickNode(clickable);
        } else {
            log("无障碍读不到「立即签到」，改用坐标点击");
        }
    } catch (e) {
        log("文本探测异常: " + e);
    }

    // 2. 坐标点击（实测按钮中心 0.39 / 0.855）
    if (!clicked) {
        log("坐标点击尝试 1/1");
        clicked = fallbackClickByRatio(BTN_X, BTN_Y);
    }

    if (!clicked) {
        log("❌ 未能点击签到按钮");
        return false;
    }

    // 3. 结果检查
    log("已点击签到按钮，等待结果...");
    sleep(2500);
    dismissPopups();
    for (let check = 0; check < 3; check++) {
        if (isSignedIn()) {
            log("✅ 签到成功");
            return true;
        }
        if (!text(SIGNIN_BTN_TEXT).exists()) {
            log("✅ 签到按钮已消失，签到成功");
            return true;
        }
        dismissPopups();
        sleep(1000);
    }

    log("⚠️ 已点击按钮，但未检测到成功标志，请手动确认");
    return true;
}

function ensureAccessibility() {
    try {
        if (auto.service) {
            log("无障碍服务已就绪");
            return true;
        }
    } catch (e) {}
    try {
        auto.waitFor();
        log("无障碍服务已就绪");
        return true;
    } catch (e) {
        log("等待无障碍服务失败: " + e);
    }
    try {
        if (auto.service) {
            log("无障碍服务已就绪（兜底检查）");
            return true;
        }
    } catch (e) {}
    return false;
}

function main() {
    log("========== 开始执行签到 ==========");

    if (!ensureAccessibility()) {
        log("无障碍服务未开启，请在系统设置中开启 Hamibot 的无障碍权限");
        return;
    }

    log("启动 " + APP_NAME + " ...");
    app.launchPackage(APP_PACKAGE);

    let appReady = false;
    const launchDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < launchDeadline) {
        if (currentPackage() === APP_PACKAGE) { appReady = true; break; }
        sleep(500);
    }
    if (!appReady) {
        log("按包名启动超时，尝试按名称启动");
        app.launchApp(APP_NAME);
        sleep(3000);
    }

    log("等待首页加载...");
    let homeLoaded = false;
    const homeDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < homeDeadline) {
        try {
            if (textMatches(".*超值套餐.*").exists() || text("营业厅").exists() || text("推荐").exists()) {
                homeLoaded = true; break;
            }
        } catch (e) {}
        sleep(POLL_INTERVAL);
    }
    log(homeLoaded ? "首页已加载" : "首页加载等待超时，继续尝试");

    log("查找「" + TARGET_TEXT + "」...");
    const node = waitForText(TARGET_TEXT, WAIT_TIMEOUT);

    let enteredSignInPage = false;
    if (node) {
        log("找到「" + TARGET_TEXT + "」控件");
        const clickable = findClickableAncestor(node, 5) || node;
        if (clickNode(clickable)) {
            log("✅ 已点击「签到有礼」");
            enteredSignInPage = true;
        } else {
            log("节点点击失败，使用比例坐标兜底");
            if (fallbackClickByRatio(ENTRY_X, ENTRY_Y)) {
                log("✅ 坐标兜底点击成功");
                enteredSignInPage = true;
            } else {
                log("❌ 兜底点击也失败");
            }
        }
    } else {
        log("❌ 未找到「" + TARGET_TEXT + "」，使用比例坐标兜底");
        if (fallbackClickByRatio(ENTRY_X, ENTRY_Y)) {
            log("✅ 兜底坐标点击成功");
            enteredSignInPage = true;
        } else {
            log("❌ 点击失败，请检查页面是否正常");
        }
    }

    if (enteredSignInPage) {
        const ok = clickSignInButton();
        log(ok ? "✅ 签到流程完成" : "⚠️ 签到流程未完成，请检查");
    } else {
        log("❌ 未能进入签到页面，跳过签到步骤");
    }

    sleep(2000);
    try { home(); } catch (e) {}

    log("========== 执行结束 ==========");
}

main();
