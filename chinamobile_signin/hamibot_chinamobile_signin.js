/**
 * Hamibot 脚本 —— 中国移动 App 每日自动签到
 *
 * 本版修复：
 *   1. 不再点击"关闭"，避免误触签到页左上角 ✕ 把页面关掉
 *   2. 进入签到页后，先用顶部标题「签到有礼」校验是否真的在签到页
 *   3. 成功判定只认明确的成功文案；H5 文字读不到时如实提示"需人工确认"
 * 不使用 console.show() / captureScreen()，避免因缺少悬浮窗、截图权限导致脚本被终止。
 */

const APP_PACKAGE = "com.greenpoint.android.mc10086.activity";
const APP_NAME = "中国移动";
const TARGET_TEXT = "签到有礼";
const WAIT_TIMEOUT = 15000;
const POLL_INTERVAL = 500;

// 签到按钮：只用精确文案
const SIGNIN_BTN_TEXT = "立即签到";
// 签到成功判定：不能用"已签到"（日历格子上本来就有），也不能用"已领取"
const SUCCESS_TEXTS = ["签到成功", "明日再来", "领取成功", "签到完成", "今日已签到"];
// 只保留安全弹窗文案，绝不能有"关闭"/"跳过"（会误触签到页左上角 ✕）
const CLOSE_TEXTS = ["我知道了", "知道了", "好的", "确定"];
// 「立即签到」按钮实测位置（按钮中心），按屏幕宽高比例
const BTN_X = 0.33;
const BTN_Y = 0.825;
// 首页「签到有礼」入口兜底坐标
const ENTRY_X = 0.62;
const ENTRY_Y = 0.155;
// 等 H5 页面渲染的时间
const H5_LOAD_WAIT = 6000;
// 判定"在签到页"的标题栏高度上限（占屏幕高度比例）
const TITLE_BAR_RATIO = 0.15;

function log(msg) {
    const line = "[中国移动签到] " + msg;
    console.log(line);
    try { toast(msg); } catch (e) {}
    try {
        files.append("/storage/emulated/0/hamibot_signin_log.txt", line + "\n");
    } catch (e) {}
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

/**
 * 判断当前是否在签到页：页面顶部标题栏出现「签到有礼」。
 * 首页那个入口文字在 y≈282，标题栏在 y≈115，用高度区分。
 */
function isOnSignInPage() {
    try {
        const nodes = text(TARGET_TEXT).find();
        if (!nodes || nodes.length === 0) return false;
        const limit = device.height * TITLE_BAR_RATIO;
        for (let i = 0; i < nodes.length; i++) {
            try {
                if (nodes[i].bounds().centerY() < limit) return true;
            } catch (e) {}
        }
    } catch (e) {}
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
    // 1. 先确认真的进了签到页（顶部标题「签到有礼」出现）
    let onPage = false;
    const pageDeadline = Date.now() + 10000;
    while (Date.now() < pageDeadline) {
        if (isOnSignInPage()) { onPage = true; break; }
        sleep(500);
    }
    if (!onPage) {
        log("❌ 未确认进入签到页（顶部标题未出现），中止以免误点");
        return false;
    }

    log("已进入签到页，等待 H5 加载 " + (H5_LOAD_WAIT / 1000) + " 秒...");
    sleep(H5_LOAD_WAIT);

    // 2. 文本优先（部分机型 webview 文字可读）
    let clicked = false;
    try {
        const node = text(SIGNIN_BTN_TEXT).findOne(1200);
        if (node) {
            log("找到「立即签到」控件（文本可读）");
            const clickable = findClickableAncestor(node, 5) || node;
            clicked = clickNode(clickable);
        } else {
            log("无障碍读不到「立即签到」，改用坐标点击");
        }
    } catch (e) {
        log("文本探测异常: " + e);
    }

    // 3. 坐标点击（按钮中心 0.33 / 0.825，附近小范围纵向扫描）
    if (!clicked) {
        const ys = [BTN_Y, BTN_Y - 0.02, BTN_Y + 0.02];
        for (let i = 0; i < ys.length; i++) {
            log("坐标点击尝试 " + (i + 1) + "/" + ys.length);
            if (fallbackClickByRatio(BTN_X, ys[i])) {
                clicked = true;
                sleep(2500);
                if (isSignedIn()) {
                    log("✅ 检测到签到成功提示");
                    return true;
                }
                if (!isOnSignInPage()) {
                    log("❌ 点击后已离开签到页，停止继续尝试");
                    return false;
                }
            }
        }
    }

    if (!clicked) {
        log("❌ 未能点击签到按钮");
        return false;
    }

    // 4. 结果确认
    sleep(1000);
    if (isSignedIn()) {
        log("✅ 检测到签到成功提示");
        return true;
    }
    log("⚠️ 已点击「立即签到」，但页面文字不可读，无法自动确认；请人工查看是否显示签到成功/按钮变为已签到");
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

    log("屏幕分辨率: " + device.width + " x " + device.height);

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
        log(ok ? "✅ 签到流程执行完毕" : "⚠️ 签到流程未完成，请检查");
    } else {
        log("❌ 未能进入签到页面，跳过签到步骤");
    }

    sleep(2000);
    try { home(); } catch (e) {}

    log("========== 执行结束 ==========");
}

log("脚本已加载，准备执行");
main();
