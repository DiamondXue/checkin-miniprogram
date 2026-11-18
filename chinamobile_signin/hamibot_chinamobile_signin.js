/**
 * Hamibot 脚本 —— 中国移动 App 每日自动签到
 *
 * 功能：
 *   1. 启动中国移动 App
 *   2. 等待首页加载
 *   3. 点击「签到有礼」入口
 *   4. 进入签到页后点击「立即签到」
 *   5. 处理签到结果弹窗
 *
 * 适用平台：Hamibot（Auto.js 兼容语法）
 * 前置：手机已安装 Hamibot 并开启无障碍服务
 * 调度：在 Hamibot 控制台设置定时任务每日自动运行
 */

// ============ 配置 ============
const APP_PACKAGE = "com.greenpoint.android.mc10086.activity";
const APP_NAME = "中国移动";
const TARGET_TEXT = "签到有礼";
const WAIT_TIMEOUT = 15000;
const POLL_INTERVAL = 500;

const SIGNIN_BTN_TEXTS = ["立即签到", "签到", "签到领奖", "签到领流量", "领取", "领流量"];
const SUCCESS_TEXTS = ["签到成功", "已签到", "明日再来", "领取成功", "签到完成", "已领取"];
const CLOSE_TEXTS = ["关闭", "我知道了", "知道了", "跳过", "好的", "确定"];

// ============ 工具函数 ============

function log(msg) {
    console.log("[中国移动签到] " + msg);
    try { toast(msg); } catch (e) {}
}

/**
 * 从目标节点向上回溯，返回第一个可点击的祖先节点（含自身）
 */
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

/**
 * 点击控件：优先节点 click()，失败用 bounds 中心坐标点击
 */
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

/**
 * 比例坐标兜底点击
 */
function fallbackClickByRatio(ratioX, ratioY) {
    const dw = device.width;
    const dh = device.height;
    const fx = Math.floor(dw * ratioX);
    const fy = Math.floor(dh * ratioY);
    log("比例坐标兜底点击: (" + fx + ", " + fy + ")");
    return click(fx, fy);
}

/**
 * 条件式等待：轮询直到找到指定文本节点或超时
 */
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

/**
 * 判断是否已签到成功
 */
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
 * 处理签到后弹出的弹窗
 */
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

/**
 * 进入签到页后，查找并点击签到按钮
 * 签到页通常是 H5 网页（webview），无障碍可能识别不到文本，
 * 因此采用「文本识别 + 坐标兜底」双策略
 */
function clickSignInButton() {
    log("进入签到页，查找签到按钮...");

    // 等待 H5 页面渲染
    sleep(2500);
    dismissPopups();
    sleep(500);

    if (isSignedIn()) {
        log("✅ 今日已签到");
        return true;
    }

    // 策略一：文本识别
    let clickedByText = false;
    for (let i = 0; i < SIGNIN_BTN_TEXTS.length; i++) {
        const node = waitForText(SIGNIN_BTN_TEXTS[i], 1500);
        if (node) {
            log("找到签到按钮（文本）: " + SIGNIN_BTN_TEXTS[i]);
            const clickable = findClickableAncestor(node, 5) || node;
            if (clickNode(clickable)) {
                clickedByText = true;
                break;
            }
        }
    }

    // 策略二：坐标兜底
    if (!clickedByText) {
        log("文本未识别到签到按钮，使用坐标兜底点击");
        dismissPopups();
        const candidates = [
            { x: 0.50, y: 0.55 },
            { x: 0.50, y: 0.60 },
            { x: 0.50, y: 0.65 },
            { x: 0.50, y: 0.50 },
        ];
        for (let c = 0; c < candidates.length; c++) {
            if (isSignedIn()) {
                log("✅ 今日已签到");
                return true;
            }
            log("坐标兜底尝试 " + (c + 1) + "/" + candidates.length);
            if (fallbackClickByRatio(candidates[c].x, candidates[c].y)) {
                sleep(1500);
                dismissPopups();
                if (isSignedIn()) {
                    log("✅ 签到成功");
                    return true;
                }
            }
        }
    }

    // 点击后检查结果
    if (clickedByText) {
        log("已点击签到按钮，等待结果...");
        sleep(2000);
        dismissPopups();
    }

    for (let check = 0; check < 3; check++) {
        if (isSignedIn()) {
            log("✅ 签到成功");
            return true;
        }
        dismissPopups();
        sleep(1000);
    }

    if (isSignedIn()) {
        log("✅ 签到成功");
        return true;
    }
    log("⚠️ 已执行签到操作，但未检测到明确的成功提示");
    return true;
}

// ============ 无障碍服务就绪检查 ============

/**
 * 确保无障碍服务已就绪。
 * 先直接检查 auto.service，若已连接则无需等待（避免 auto.waitFor()
 * 在已连接状态下抛出 ScriptInterruptedException）；
 * 仅在未连接时才调用 auto.waitFor() 阻塞等待。
 */
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
    // 兜底：再次检查
    try {
        if (auto.service) {
            log("无障碍服务已就绪（兜底检查）");
            return true;
        }
    } catch (e) {}
    return false;
}

// ============ 主流程 ============

function main() {
    log("========== 开始执行签到 ==========");

    if (!ensureAccessibility()) {
        log("无障碍服务未开启，请在系统设置中开启 Hamibot 的无障碍权限");
        return;
    }

    // 1. 启动中国移动 App
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

    // 2. 等待首页加载
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

    // 3. 查找并点击「签到有礼」
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
            if (fallbackClickByRatio(0.68, 0.15)) {
                log("✅ 坐标兜底点击成功");
                enteredSignInPage = true;
            } else {
                log("❌ 兜底点击也失败");
            }
        }
    } else {
        log("❌ 未找到「" + TARGET_TEXT + "」，使用比例坐标兜底");
        if (fallbackClickByRatio(0.68, 0.15)) {
            log("✅ 兜底坐标点击成功");
            enteredSignInPage = true;
        } else {
            log("❌ 点击失败，请检查页面是否正常");
        }
    }

    // 4. 进入签到页后点击「立即签到」
    if (enteredSignInPage) {
        const ok = clickSignInButton();
        log(ok ? "✅ 签到流程完成" : "⚠️ 签到流程未完成，请检查");
    } else {
        log("❌ 未能进入签到页面，跳过签到步骤");
    }

    // 5. 返回桌面
    sleep(2000);
    try { home(); } catch (e) {}

    log("========== 执行结束 ==========");
}

main();
