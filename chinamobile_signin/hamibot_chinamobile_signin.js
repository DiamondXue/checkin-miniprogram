/**
 * Hamibot 脚本 —— 中国移动 App 每日自动签到
 *
 * 关键说明：
 *   「签到有礼」页面是纯 H5 网页（webview），无障碍服务读不到里面的
 *   任何文字（"已累计签到""立即签到"都读不到）。因此签到页内一律用
 *   固定等待 + 坐标点击，不再做文本等待。
 */

// ============ 配置 ============
const APP_PACKAGE = "com.greenpoint.android.mc10086.activity";
const APP_NAME = "中国移动";
const TARGET_TEXT = "签到有礼";

const WAIT_TIMEOUT = 15000;
const POLL_INTERVAL = 500;

// 首页「签到有礼」入口位置（截屏实测比例）
const ENTRY_X = 0.62;
const ENTRY_Y = 0.155;

// 签到页「立即签到」按钮位置（截屏实测比例，按钮中心）
const BTN_X = 0.39;
const BTN_Y = 0.855;

// 签到页 H5 加载等待时间
const H5_LOAD_WAIT = 6000;

// 调试开关：true 时在屏幕上显示日志浮窗（调好后可改 false）
const DEBUG_SHOW_CONSOLE = true;

// ============ 基础工具 ============

function log(msg) {
    console.log(msg);
    try { toast(msg); } catch (e) {}
}

function shot(name) {
    try {
        const p = "/sdcard/" + name + "_" + Date.now() + ".png";
        captureScreen(p);
        log("截图已保存: " + p);
        return p;
    } catch (e) {
        log("截图失败: " + e);
        return null;
    }
}

function clickRatio(rx, ry, tag) {
    const x = Math.floor(device.width * rx);
    const y = Math.floor(device.height * ry);
    log("点击 " + (tag || "") + " -> (" + x + ", " + y + ")");
    const ok = click(x, y);
    log(ok ? "  点击指令已执行" : "  点击指令失败");
    return ok;
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

function ensureAccessibility() {
    try {
        if (auto.service) {
            log("无障碍服务：已连接");
            return true;
        }
        log("无障碍服务：未连接，尝试等待...");
    } catch (e) {
        log("读取 auto.service 异常: " + e);
    }

    try {
        auto.waitFor();
    } catch (e) {
        log("auto.waitFor() 异常: " + e);
    }

    try {
        if (auto.service) {
            log("无障碍服务：等待后已连接");
            return true;
        }
    } catch (e) {}
    return false;
}

/**
 * 无障碍不可用时，直接跳到系统无障碍设置页，方便用户开启
 */
function openAccessibilitySettings() {
    try {
        app.startActivity({ action: "android.settings.ACCESSIBILITY_SETTINGS" });
        log("已跳转到无障碍设置，请找到 Hamibot 并开启");
    } catch (e) {
        log("跳转设置页失败: " + e);
    }
}

// ============ 签到页内操作 ============

function doSignIn() {
    log("[5/5] 已进入签到页，等待 H5 加载 " + (H5_LOAD_WAIT / 1000) + " 秒...");
    sleep(H5_LOAD_WAIT);
    shot("01_签到页");

    // 万一某些机型能读到 H5 文本，优先用节点点击
    let clicked = false;
    try {
        const node = text("立即签到").findOne(1500);
        if (node) {
            log("检测到「立即签到」文本控件，尝试节点点击");
            const target = findClickableAncestor(node, 5) || node;
            const b = target.bounds();
            log("  控件坐标: (" + b.centerX() + ", " + b.centerY() + ")");
            if (target.clickable() && target.click()) {
                log("  节点点击成功");
                clicked = true;
            } else if (click(b.centerX(), b.centerY())) {
                log("  坐标点击成功");
                clicked = true;
            }
        } else {
            log("无障碍读不到 H5 中的「立即签到」，改用固定坐标");
        }
    } catch (e) {
        log("文本探测异常: " + e);
    }

    if (!clicked) {
        clickRatio(BTN_X, BTN_Y, "立即签到按钮");
        clicked = true;
    }

    log("点击完成，等待签到结果...");
    sleep(3000);
    shot("02_签到后");

    // 尝试关闭可能出现的弹窗（若 H5 弹出层能被读到）
    const closers = ["关闭", "我知道了", "知道了", "好的", "确定"];
    for (let i = 0; i < closers.length; i++) {
        try {
            const n = text(closers[i]).findOne(600) || desc(closers[i]).findOne(600);
            if (n) {
                log("发现弹窗按钮: " + closers[i]);
                const t = findClickableAncestor(n, 3) || n;
                const b = t.bounds();
                if (!(t.clickable() && t.click())) click(b.centerX(), b.centerY());
                sleep(800);
                break;
            }
        } catch (e) {}
    }

    log("[5/5] 签到动作已执行，请查看截图确认结果（/sdcard/02_签到后_*.png）");
    return true;
}

// ============ 主流程 ============

function main() {
    // 先给出"脚本已启动"的明确反馈，避免误以为没运行
    try { toast("脚本已启动"); } catch (e) {}

    if (DEBUG_SHOW_CONSOLE) {
        try { console.show(); } catch (e) {}
    }

    log("========== 中国移动自动签到 开始 ==========");
    log("屏幕尺寸: " + device.width + " x " + device.height);

    log("[1/5] 检查无障碍服务");
    if (!ensureAccessibility()) {
        log("❌ 无障碍服务未开启");
        log("请到 设置 → 无障碍 → 已下载的服务/已安装的服务 → 找到【Hamibot】并开启");
        log("注意：只开 AutoX.js 的无障碍不行，Hamibot 必须单独开启");
        openAccessibilitySettings();
        return;
    }

    log("[2/5] 启动 " + APP_NAME);
    app.launchPackage(APP_PACKAGE);

    let appReady = false;
    const launchDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < launchDeadline) {
        try {
            if (currentPackage() === APP_PACKAGE) { appReady = true; break; }
        } catch (e) {}
        sleep(500);
    }
    if (!appReady) {
        log("包名启动超时，尝试按名称启动");
        app.launchApp(APP_NAME);
        sleep(3000);
    }
    log("  当前包名: " + currentPackage());

    log("[3/5] 等待首页加载...");
    let homeLoaded = false;
    const homeDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < homeDeadline) {
        try {
            if (textMatches(".*超值套餐.*").exists() || text("营业厅").exists()
                || text("推荐").exists() || text("签到有礼").exists()) {
                homeLoaded = true; break;
            }
        } catch (e) {}
        sleep(POLL_INTERVAL);
    }
    log(homeLoaded ? "  首页已加载" : "  首页等待超时，继续尝试");
    sleep(1000);

    log("[4/5] 点击「签到有礼」入口");
    let entered = false;
    const entryNode = waitForText(TARGET_TEXT, 5000);
    if (entryNode) {
        log("  文本找到入口，尝试节点点击");
        const t = findClickableAncestor(entryNode, 5) || entryNode;
        const b = t.bounds();
        log("  入口坐标: (" + b.centerX() + ", " + b.centerY() + ")");
        if (t.clickable() && t.click()) {
            log("  节点点击成功");
            entered = true;
        } else if (click(b.centerX(), b.centerY())) {
            log("  坐标点击成功");
            entered = true;
        }
    }
    if (!entered) {
        log("  文本未找到入口，改用固定坐标");
        entered = clickRatio(ENTRY_X, ENTRY_Y, "签到有礼入口");
    }
    sleep(2000);

    if (!entered) {
        log("❌ 未能进入签到页面，流程结束");
        return;
    }

    doSignIn();

    sleep(2000);
    log("========== 执行结束 ==========");
}

try {
    main();
} catch (e) {
    log("脚本异常: " + e);
    try { toast("脚本异常: " + e); } catch (err) {}
}

