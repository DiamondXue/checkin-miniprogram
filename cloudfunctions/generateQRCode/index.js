const cloud = require('wx-server-sdk');
const qr = require('qr-image');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 生成二维码并上传到云存储
 * 
 * 参数：
 * - text: 要编码的文本（必须）
 * - size: 图片尺寸 px（可选，默认 430）
 * 
 * 返回：
 * - success: true/false
 * - fileID: 云文件 ID（成功时）
 * - fileLink: 临时访问链接（成功时，有效期 2 小时）
 * - error: 错误信息（失败时）
 */
exports.main = async (event, context) => {
  const { text, size = 430 } = event;

  if (!text) {
    return { success: false, error: '缺少参数 text' };
  }

  try {
    console.log('[云函数] 开始生成二维码, text:', text);

    // 1. 生成二维码 PNG buffer
    const qrSvg = qr.imageSync(text, {
      type: 'png',
      size: 10,        // 模块放大倍数（qr-image 用 ec_level 控制纠错）
      ec_level: 'M',    // 中等纠错级别
      margin: 2,        // 安静区宽度（模块数）
    });

    console.log('[云函数] 二维码 PNG 已生成, 大小:', qrSvg.length, 'bytes');

    // 2. 上传到云存储
    const fileName = `qrcodes/${Date.now()}-${Math.random().toString(36).substr(2, 6)}.png`;
    
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: qrSvg,
    });

    console.log('[云函数] 上传成功, fileID:', uploadResult.fileID);

    // 3. 获取临时访问链接（用于 `` 显示）
    const fileListResult = await cloud.getTempFileURL({
      fileList: [uploadResult.fileID],
    });

    const fileLink = fileListResult.fileList[0].tempFileURL;

    console.log('[云函数] 临时链接已生成');

    return {
      success: true,
      fileID: uploadResult.fileID,
      fileLink: fileLink,  // 2 小时有效
    };

  } catch (err) {
    console.error('[云函数] 生成失败:', err);
    return {
      success: false,
      error: err.message || '未知错误',
    };
  }
};
