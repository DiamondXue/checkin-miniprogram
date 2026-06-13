/**
 * 中国标准时间（UTC+8）工具
 * 微信小程序中 new Date() 在不同平台（真机/开发者工具/PC客户端）
 * 可能返回 UTC 时间而非本地时间，所以显式基于 UTC 加上 +8 偏移，
 * 不再依赖运行环境的本地时区。
 */

const CST_OFFSET = 8 * 60; // UTC+8 分钟数

/**
 * 获取当前中国标准时间的 Date 对象（基于 UTC 时间戳 + 8小时偏移）
 * 用法：用返回对象的 getUTCHours/getUTCMinutes/getUTCDate 等方法获取 CST 各字段
 */
function cstNow() {
  return new Date(Date.now() + CST_OFFSET * 60000);
}

/**
 * 格式化中国标准时间为 YYYYMMDD 字符串（同之前 _formatDate 的输出格式）
 */
function cstDateStr() {
  const d = cstNow();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dt = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dt}`;
}

/**
 * 格式化中国标准时间为 HH:MM 字符串
 */
function cstTimeStr() {
  const d = cstNow();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 获取中国标准时间的分钟总数（0:00 起算）
 */
function cstTotalMinutes() {
  const d = cstNow();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

module.exports = {
  cstNow,
  cstDateStr,
  cstTimeStr,
  cstTotalMinutes,
};
