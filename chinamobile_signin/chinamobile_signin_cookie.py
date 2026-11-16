#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中国移动每日签到 —— 云端 Cookie 方案（备选）

原理：
    中国移动 App 内的「签到有礼」本质上是调用 wx.10086.cn 的接口。
    用抓包工具（如 mitmproxy / 小黄鸟 HttpCanary / Stream）抓取签到请求的
    Cookie 后，即可在服务器上用脚本定时调用签到接口，无需手机。

使用前准备（重要）：
    1. 在手机上安装抓包工具（推荐 HttpCanary 或 Stream），安装 CA 证书
    2. 打开中国移动 App → 签到有礼页面，手动签到一次
    3. 在抓包记录中找到对 wx.10086.cn 的请求（路径含 taskCenter）
    4. 复制请求中的 Cookie（以及 Authorization，如果有）
    5. 填入下方 CM_COOKIE 环境变量或配置文件

运行：
    export CM_COOKIE="你的完整Cookie"
    python3 chinamobile_signin_cookie.py

定时：
    crontab -e   添加:  30 8 * * * cd /path && python3 chinamobile_signin_cookie.py >> signin.log 2>&1

注意：
    - Cookie 会过期，过期后需重新抓包更新
    - 接口可能随版本变化，如失效请更新脚本
"""

import os
import sys
import json
import time
import random
import requests
from urllib.parse import urlparse, parse_qs, urlencode

# ============ 配置 ============
# 从环境变量读取 Cookie（推荐），也可直接写死
CM_COOKIE = os.environ.get("CM_COOKIE", "")
# 可选：Authorization 头（部分接口需要）
CM_AUTH = os.environ.get("CM_AUTH", "")
# 签到请求的完整 URL（从抓包中复制，含 query 参数）
# 例如: http://wx.10086.cn/website/taskCenter/sign?url=xxxxx
CM_SIGN_URL = os.environ.get("CM_SIGN_URL", "")

# 请求头（模拟手机 App 内置浏览器）
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 "
        "Mobile Safari/537.36; unicom{version:android@8.0100,desmobileId:"
        "android_phone}"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "http://wx.10086.cn/website/taskCenter/index",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://wx.10086.cn",
}


def log(msg):
    print(f"[中国移动签到] {msg}", flush=True)


def build_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    if CM_COOKIE:
        s.headers["Cookie"] = CM_COOKIE
    if CM_AUTH:
        s.headers["Authorization"] = CM_AUTH
    return s


def get_sign_url(session):
    """
    如果用户没有提供完整的签到 URL，则尝试先访问 taskCenter/index
    解析出签到所需的 url 参数。
    """
    if CM_SIGN_URL:
        return CM_SIGN_URL

    log("未配置 CM_SIGN_URL，尝试从首页获取签到链接...")
    # 部分版本需要先访问 index 页面获得跳转链接
    index_url = "http://wx.10086.cn/website/taskCenter/index"
    try:
        r = session.get(index_url, timeout=15, allow_redirects=True)
        log(f"index 响应: HTTP {r.status_code}, 长度 {len(r.text)}")
        # 尝试从 HTML/JS 中提取 sign 接口的 url 参数
        # 这里只是一个通用尝试，实际参数结构以抓包为准
        import re
        m = re.search(r'taskCenter/sign\?url=([^"\'&]+)', r.text)
        if m:
            sign_url = f"http://wx.10086.cn/website/taskCenter/sign?url={m.group(1)}"
            log(f"解析到签到链接: {sign_url[:120]}...")
            return sign_url
    except Exception as e:
        log(f"获取 index 失败: {e}")

    log("无法自动获取签到链接，请设置 CM_SIGN_URL 环境变量（从抓包复制完整签到 URL）")
    return None


def do_signin(session, sign_url):
    """执行签到请求"""
    log(f"请求签到接口: {sign_url[:150]}...")
    # 随机延迟，模拟人工
    time.sleep(random.uniform(0.5, 2.0))

    try:
        # 签到通常是 POST，也可能是 GET，两种都试
        r = session.post(sign_url, timeout=20)
        if r.status_code == 405 or r.status_code == 404:
            log("POST 不支持，尝试 GET...")
            r = session.get(sign_url, timeout=20)

        log(f"签到响应: HTTP {r.status_code}")
        log(f"响应内容: {r.text[:500]}")

        # 尝试解析 JSON 响应
        try:
            data = r.json()
            code = data.get("code") or data.get("retCode") or data.get("status")
            msg = data.get("msg") or data.get("message") or data.get("retMsg") or ""
            log(f"接口返回: code={code}, msg={msg}")
            if str(code) in ("0", "200", "0000", "000000", "10000"):
                log("✅ 签到成功！")
                return True
            elif "已签到" in msg or "重复" in msg or "明日" in msg:
                log("ℹ️  今日已签到")
                return True
            else:
                log(f"❌ 签到失败: {msg}")
                return False
        except json.JSONDecodeError:
            # 非 JSON 响应，根据内容判断
            text = r.text
            if "签到成功" in text or "已签到" in text or "success" in text.lower():
                log("✅ 签到成功（从响应文本判断）")
                return True
            elif "未登录" in text or "登录" in text and "过期" in text:
                log("❌ Cookie 已过期，请重新抓包")
                return False
            else:
                log(f"⚠️  无法判断结果，请检查响应")
                return False
    except Exception as e:
        log(f"❌ 请求异常: {e}")
        return False


def main():
    if not CM_COOKIE:
        log("错误：未设置 CM_COOKIE 环境变量")
        log("请先抓包获取 Cookie，然后: export CM_COOKIE='你的Cookie'")
        sys.exit(1)

    log("========== 开始签到 ==========")
    session = build_session()

    sign_url = get_sign_url(session)
    if not sign_url:
        sys.exit(1)

    ok = do_signin(session, sign_url)
    log("========== 签到结束 ==========")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
