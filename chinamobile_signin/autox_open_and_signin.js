/**
 * AutoX.js 7.0.5 脚本 —— 打开中国移动 App 并点击「签到有礼」
 *
 * 功能：
 *   1. 启动中国移动 App
 *   2. 等待首页加载完成
 *   3. 查找并点击「签到有礼」按钮
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
function waitForText(text, timeout) {
    timeout = timeout || WAIT_TIMEOUT;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        let node = text(text).findOne(200);
        if (node) return node;
        // 模糊匹配
        node = textMatches(".*" + text + ".*").findOne(200);
        if (node) return node;
        sleep(POLL_INTERVAL);
    }
    return null;
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

    if (node) {
        log("找到「" + TARGET_TEXT + "」控件");
        // 向上找可点击祖先，避免点到不可点击的文本节点
        const clickable = findClickableAncestor(node, 5) || node;
        if (clickNode(clickable)) {
            log("✅ 已点击「签到有礼」");
        } else {
            // 节点点击失败，用比例坐标兜底
            log("节点点击失败，使用比例坐标兜底");
            if (fallbackClickByRatio(0.68, 0.15)) {
                log("✅ 坐标兜底点击成功");
            } else {
                log("❌ 兜底点击也失败");
            }
        }
    } else {
        log("❌ 未找到「" + TARGET_TEXT + "」，使用比例坐标兜底");
        if (fallbackClickByRatio(0.68, 0.15)) {
            log("✅ 兜底坐标点击成功");
        } else {
            log("❌ 点击失败，请检查页面是否正常");
        }
    }

    log("========== 执行结束 ==========");
}

main();
