/**
 * AutoX.js 7.0.5 脚本 —— 打开中国移动 App 并完成每日签到
 *
 * 功能：
 *   1. 启动中国移动 App
 *   2. 等待首页加载完成
 *   3. 查找并点击「签到有礼」按钮
 *   4. 进入签到页后点击「立即签到」
 *   5. 处理签到结果弹窗
 *
 * 适用：AutoX.js 7.0.5（Auto.js 分支，API 兼容）
 * 前置：已开启无障碍服务
 */

// ============ 配置 ============
const APP_PACKAGE = "com.greenpoint.android.mc10086.activity"; // 中国移动包名
const APP_NAME = "中国移动";
const TARGET_TEXT = "签到有礼";
const WAIT_TIMEOUT = 15000; // 等待超时（毫秒）
const POLL_INTERVAL = 500;  // 轮询间隔（毫秒）

// 签到按钮可能的文案（按优先级）
const SIGNIN_BTN_TEXTS = ["立即签到", "签到", "签到领奖", "签到领流量", "领取", "领流量"];
// 签到成功/已签到的文案
const SUCCESS_TEXTS = ["签到成功", "已签到", "明日再来", "领取成功", "签到完成", "已领取"];
// 弹窗关闭按钮文案
const CLOSE_TEXTS = ["关闭", "我知道了", "知道了", "跳过", "好的", "确定"];

// ============ 工具函数 ============

function log(msg) {
    console.log("[中国移动] " + msg);
    toast(msg);
}

/**
 * 从目标节点向上回溯，返回第一个可点击的祖先节点（含自身）
 * 解决「文本节点本身不可点、事件绑在父容器」的问题
 */
function findClickableAncestor(node, maxDepth) {
    maxDepth = maxDepth || 5;
    let cur = node;
    for (let i = 0; i < maxDepth && cur; i++) {
        if (cur.clickable()) {
            return cur;
        }
        cur = cur.parent();
    }
    return null;
}

/**
 * 点击控件：优先用节点 click()，失败则用 bounds 中心坐标点击
 * 输出实际点击坐标便于排查
 */
function clickNode(node) {
    if (!node) return false;
    const b = node.bounds();
    const cx = b.centerX();
    const cy = b.centerY();
    log("点击目标坐标: (" + cx + ", " + cy + ")");
    // 优先节点点击
    if (node.clickable() && node.click()) {
        log("节点点击成功");
        return true;
    }
    // 兜底：坐标点击
    if (click(cx, cy)) {
        log("坐标点击成功");
        return true;
    }
    log("点击失败");
    return false;
}

/**
 * 比例坐标兜底点击：根据设备宽高换算，避免硬编码像素
 * 根据截图，「签到有礼」约在屏幕 68% 宽、15% 高位置
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
 * 返回找到的节点，找不到返回 null
 */
function waitForText(txt, timeout) {
    timeout = timeout || WAIT_TIMEOUT;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        let node = text(txt).findOne(200);
        if (node) return node;
        node = textMatches(".*" + txt + ".*").findOne(200);
        if (node) return node;
        sleep(POLL_INTERVAL);
    }
    return null;
}

/**
 * 条件式等待：轮询直到文本列表中任一文本出现
 */
function waitForAnyText(textList, timeout) {
    timeout = timeout || WAIT_TIMEOUT;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (let i = 0; i < textList.length; i++) {
            const node = waitForText(textList[i], 300);
            if (node) return { text: textList[i], node: node };
        }
        sleep(POLL_INTERVAL);
    }
    return null;
}

/**
 * 判断是否已签到成功（页面出现成功/已签到文案）
 */
function isSignedIn() {
    for (let i = 0; i < SUCCESS_TEXTS.length; i++) {
        if (textMatches(".*" + SUCCESS_TEXTS[i] + ".*").exists()) {
            log("检测到签到结果: " + SUCCESS_TEXTS[i]);
            return true;
        }
    }
    return false;
}

/**
 * 处理签到后弹出的弹窗（关闭/我知道了 等）
 */
function dismissPopups() {
    for (let i = 0; i < CLOSE_TEXTS.length; i++) {
        const node = text(CLOSE_TEXTS[i]).findOne(300) || desc(CLOSE_TEXTS[i]).findOne(300);
        if (node) {
            log("关闭弹窗: " + CLOSE_TEXTS[i]);
            const clickable = findClickableAncestor(node, 3) || node;
            clickNode(clickable);
            sleep(800);
            return true;
        }
    }
    return false;
}

/**
 * 进入签到页后，查找并点击签到按钮
 * 返回 true 表示点击成功，false 表示未找到按钮
 */
function clickSignInButton() {
    log("进入签到页，查找签到按钮...");

    // 先等一下页面渲染
    sleep(1000);
    // 关闭可能的广告弹窗
    dismissPopups();

    // 轮询查找签到按钮
    const deadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < deadline) {
        // 先检查是否已经签到过了
        if (isSignedIn()) {
            log("✅ 今日已签到");
            return true;
        }
        // 尝试各种签到按钮文案
        for (let i = 0; i < SIGNIN_BTN_TEXTS.length; i++) {
            const node = waitForText(SIGNIN_BTN_TEXTS[i], 800);
            if (node) {
                log("找到签到按钮: " + SIGNIN_BTN_TEXTS[i]);
                const clickable = findClickableAncestor(node, 5) || node;
                if (clickNode(clickable)) {
                    log("已点击签到按钮，等待结果...");
                    sleep(1500);
                    // 签到后处理弹窗
                    dismissPopups();
                    // 检查是否成功
                    if (isSignedIn()) {
                        log("✅ 签到成功");
                        return true;
                    }
                    // 可能弹窗需要再关一次
                    dismissPopups();
                    if (isSignedIn()) {
                        log("✅ 签到成功");
                        return true;
                    }
                    log("⚠️ 已点击但未检测到成功提示，可能需要人工确认");
                    return true;
                }
            }
        }
        sleep(POLL_INTERVAL);
    }

    // 没找到签到按钮，可能已签到或按钮文案不同
    if (isSignedIn()) {
        log("✅ 今日已签到");
        return true;
    }
    log("❌ 未找到签到按钮，也未检测到已签到状态");
    return false;
}

// ============ 主流程 ============

function main() {
    log("========== 开始执行 ==========");

    // 1. 检查无障碍服务
    if (!auto.service) {
        log("请先开启无障碍服务！");
        return;
    }

    // 2. 启动中国移动 App
    log("启动 " + APP_NAME + " ...");
    app.launchPackage(APP_PACKAGE);

    // 等待 App 进程出现
    let appReady = false;
    const launchDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < launchDeadline) {
        if (currentPackage() === APP_PACKAGE) {
            appReady = true;
            break;
        }
        sleep(500);
    }
    if (!appReady) {
        // 兜底：按应用名启动
        log("按包名启动超时，尝试按名称启动");
        app.launchApp(APP_NAME);
        sleep(3000);
    }

    // 3. 等待首页加载（出现搜索框或首页关键元素）
    log("等待首页加载...");
    let homeLoaded = false;
    const homeDeadline = Date.now() + WAIT_TIMEOUT;
    while (Date.now() < homeDeadline) {
        if (textMatches(".*超值套餐.*").exists() || text("营业厅").exists() || text("推荐").exists()) {
            homeLoaded = true;
            break;
        }
        sleep(POLL_INTERVAL);
    }
    log(homeLoaded ? "首页已加载" : "首页加载等待超时，继续尝试");

    // 4. 查找并点击「签到有礼」
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

    // 5. 进入签到页后点击「立即签到」
    if (enteredSignInPage) {
        const ok = clickSignInButton();
        log(ok ? "✅ 签到流程完成" : "⚠️ 签到流程未完成，请检查");
    } else {
        log("❌ 未能进入签到页面，跳过签到步骤");
    }

    log("========== 执行结束 ==========");
}

main();
