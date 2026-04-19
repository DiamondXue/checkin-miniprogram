/**
 * 地理位置工具函数
 */

/**
 * 使用 Haversine 公式计算两点之间的距离（米）
 * @param {number} lat1 - 起点纬度
 * @param {number} lon1 - 起点经度
 * @param {number} lat2 - 终点纬度
 * @param {number} lon2 - 终点经度
 * @returns {number} 距离（米）
 */
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * 格式化距离显示
 * @param {number} meters
 * @returns {string}
 */
function formatDistance(meters) {
  if (meters < 1000) return `${meters} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

/**
 * 获取当前用户位置（Promise 封装）
 * @returns {Promise<{latitude, longitude}>}
 */
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: res => resolve({ latitude: res.latitude, longitude: res.longitude }),
      fail: err => reject(err)
    });
  });
}

/**
 * 验证用户是否在签到范围内
 * @param {object} activity - 含 latitude/longitude/checkinRadius 的活动对象
 * @returns {Promise<{valid: boolean, distance: number, message: string}>}
 */
async function verifyCheckinLocation(activity) {
  // 如果活动没有配置坐标或半径为 0，跳过位置验证
  if (!activity.latitude || !activity.longitude || activity.checkinRadius === 0) {
    return { valid: true, distance: 0, message: '' };
  }

  try {
    const pos = await getCurrentLocation();
    const distance = calcDistance(
      pos.latitude, pos.longitude,
      activity.latitude, activity.longitude
    );

    if (distance <= activity.checkinRadius) {
      return { valid: true, distance, message: `距活动地点 ${formatDistance(distance)}` };
    } else {
      return {
        valid: false,
        distance,
        message: `您当前距活动地点 ${formatDistance(distance)}，需在 ${formatDistance(activity.checkinRadius)} 内才能签到`
      };
    }
  } catch (err) {
    // 获取位置失败（拒绝授权等），询问用户是否强制签到
    return { valid: false, distance: -1, message: '无法获取您的位置，请检查位置权限设置' };
  }
}

module.exports = { calcDistance, formatDistance, getCurrentLocation, verifyCheckinLocation };
