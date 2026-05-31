// 云函数：initUsers
// 用途：初始化 users 集合，录入所有用户（管理员 + 操作员 + 活动创建人 + 普通用户）
// 使用方法：编辑下方 USERS 数组，右键上传部署，手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ============================================================
// ✏️ 在下方 USERS 数组里填入用户信息
// 字段说明：
//   staffId  - 8位工号（必填，唯一）
//   name     - 姓名（必填）
//   dept     - 部门（可选）
//   group    - 分组编号（可选，数字）
//   roles    - 角色数组（默认 ['user']），可叠加多个角色：
//              admin（超级管理员，可管理/删除所有活动）
//              operator（操作员，可管理/编辑所有活动，但不能删除）
//              organizer（活动创建人，仅管理自己创建的活动）
//              user（普通成员，仅签到）
//              例：roles: ['operator'] 表示可以管理所有活动的签到情况
// 数据来源：2026 WPS GZ Spring Outing Registration List（小鹏科技园_20260528.xlsx）
// ============================================================
const USERS = [
  // ── 管理员/操作员 ──────────────────────────────────────────
  { staffId: '43334382', name: 'Diamond Xue', dept: 'Wealth Management', group: 1, roles: ['admin', 'organizer'] },
  { staffId: '20260516', name: '工作人员', dept: '供应商', roles: ['operator'] },

  // ── 参与者（73人，来自 Excel）──────────────────────────────
  { staffId: '43868587', name: 'William Xiao', dept: 'GFX', group: 2 },
  { staffId: '43361890', name: 'Mark Chen', dept: 'Transaction Banking', group: 3 },
  { staffId: '45135550', name: 'Sunson H Q Zhang', dept: 'Transaction Banking', group: 4 },
  { staffId: '45087840', name: 'Guo Liang Su', dept: 'Transaction Banking', group: 5 },
  { staffId: '45081832', name: 'Audrey K H Yang', dept: 'Transaction Banking', group: 6 },
  { staffId: '45482018', name: 'Olivia Wan', dept: 'Transaction Banking', group: 7 },
  { staffId: '43408878', name: 'Joy Li', dept: 'WPS', group: 8 },
  { staffId: '43561658', name: 'Wier Yang', dept: 'iWPB', group: 9 },
  { staffId: '45151788', name: 'Jim Wang', dept: 'Transaction Banking', group: 2 },
  { staffId: '43687304', name: 'Ivy He', dept: 'IWPB', group: 3 },
  { staffId: '45247009', name: 'Vicky Yan Liang', dept: 'Transaction Banking', group: 1 },
  { staffId: '43457407', name: 'Yuanqin Liu', dept: 'Transaction Banking', group: 4 },
  { staffId: '43933878', name: 'Hong Min Plery Si Tu', dept: 'WPB', group: 5 },
  { staffId: '45379795', name: 'Eric Lin', dept: 'GFX', group: 6 },
  { staffId: '43540068', name: 'Eleven Qin', dept: 'IWPB Transaction Banking', group: 7 },
  { staffId: '45417277', name: 'Chun Du', dept: 'Transaction bank C&R', group: 8 },
  { staffId: '45482297', name: 'Jack Lau', dept: 'IWPB', group: 9 },
  { staffId: '45460893', name: 'Chris Yu Chen', dept: 'GFX', group: 2 },
  { staffId: '34069066', name: 'Sunny You', dept: 'Transaction Banking', group: 3 },
  { staffId: '45461188', name: 'Antonio Huang', dept: 'Lending (UNSECURED LENDING + SECURED LENDING)', group: 4 },
  { staffId: '43800323', name: 'Ning Lei', dept: 'Lending (UNSECURED LENDING + SECURED LENDING)', group: 5 },
  { staffId: '45270641', name: 'Yansen Z Q Yang', dept: 'Lending', group: 6 },
  { staffId: '34802151', name: 'Mandy Wu', dept: 'International & Premier', group: 7 },
  { staffId: '43946391', name: 'Linda Lin', dept: 'International & Premier', group: 8 },
  { staffId: '45299420', name: 'Mingcong Chen', dept: 'International & Premier', group: 1 },
  { staffId: '43580821', name: 'Bruce X J Ou', dept: 'WPB', group: 3 },
  { staffId: '43467384', name: 'Yoland Liang', dept: 'Iwpb', group: 1 },
  { staffId: '43545517', name: 'Kinson Deng', dept: 'FCS', group: 6 },
  { staffId: '43950153', name: 'Jin Rong Jenny Zhuang', dept: 'FCS (FRAUD + DECISIONING + COLLECTIONS)', group: 2 },
  { staffId: '43683330', name: 'Nancy J H Liu', dept: 'Fraud - Card', group: 3 },
  { staffId: '45482019', name: 'Shane Hui', dept: 'Accounts', group: 4 },
  { staffId: '45106720', name: 'Eva Yih', dept: 'Accounts', group: 5 },
  { staffId: '45481996', name: 'Yuki Xue', dept: 'Accounts', group: 7 },
  { staffId: '45381041', name: 'Hao Chen', dept: 'SPS (STRAT. PGM & SERV. RESILIENCE)', group: 8 },
  { staffId: '34051619', name: 'Rui Qi Wang', dept: 'iwpb', group: 9 },
  { staffId: '43909091', name: 'Cecilia Qin', dept: 'SPS (STRAT. PGM & SERV. RESILIENCE)', group: 1 },
  { staffId: '43959541', name: 'Carlos Yong Chen', dept: 'Wealth Management', group: 1 },
  { staffId: '43663760', name: 'Derek Liu', dept: 'Wealth Management', group: 2 },
  { staffId: '45041540', name: 'Jun Li', dept: 'WPS CTO', group: 3 },
  { staffId: '43167017', name: 'Crystal Hu', dept: 'WPB', group: 4 },
  { staffId: '34065817', name: 'Benson J B Liang', dept: 'Wealth Management', group: 5 },
  { staffId: '45043670', name: 'Taylor Wang', dept: 'Wealth CTO', group: 6 },
  { staffId: '45042694', name: 'Michael Shen', dept: 'Wealth Management', group: 1 },
  { staffId: '43457731', name: 'Kitty Li', dept: 'Wealth Solutions', group: 7 },
  { staffId: '44001013', name: 'Rachel Q J LV', dept: 'Wealth Management', group: 8 },
  { staffId: '43733299', name: 'Don Lu', dept: 'Wealth Management', group: 9 },
  { staffId: '45211802', name: 'Griffin Mai', dept: 'Wealth Management', group: 2 },
  { staffId: '43631229', name: 'Lucia X M Zhu', dept: 'Wealth Management', group: 4 },
  { staffId: '45029676', name: 'Lucia M J Cai', dept: 'Wealth Management', group: 5 },
  { staffId: '45454233', name: 'Eason Cheng', dept: 'DIGITAL SOLUTIONS', group: 6 },
  { staffId: '45190082', name: 'Joako Feng', dept: 'WPB', group: 7 },
  { staffId: '43227720', name: 'Greeny Chen', dept: 'Wealth CTO', group: 8 },
  { staffId: '43170460', name: 'Winland W L Mai', dept: 'Wealth Management', group: 9 },
  { staffId: '45043450', name: 'Fred Long', dept: 'DIGITAL SOLUTIONS', group: 1 },
  { staffId: '43427655', name: 'Yippee Huang', dept: 'Wealth Management', group: 2 },
  { staffId: '43445199', name: 'Novo Q Y LI', dept: 'Wealth Management', group: 3 },
  { staffId: '45164126', name: 'Stephen Zhang', dept: 'Wealth Management', group: 4 },
  { staffId: '43972641', name: 'Vincent W X Huang', dept: 'IWPB', group: 5 },
  { staffId: '43334616', name: 'Tony Cheng', dept: 'Trading Solution', group: 6 },
  { staffId: '43604841', name: 'Wing Xie', dept: 'CTO', group: 7 },
  { staffId: '45463737', name: 'Bo Deng', dept: 'Wealth Management', group: 8 },
  { staffId: '45269184', name: 'Caroline J W Zhang', dept: 'Wealth CTO', group: 9 },
  { staffId: '45169514', name: 'Mark Su', dept: 'Wealth Management', group: 2 },
  { staffId: '45489768', name: 'Kim Zhou', dept: 'Wealth Management', group: 3 },
  { staffId: '43339625', name: 'Johnson Z S Wei', dept: 'IWPB', group: 4 },
  { staffId: '43228393', name: 'Michael Z Wang', dept: 'Wealth Management', group: 5 },
  { staffId: '43334290', name: 'Roy Luo', dept: 'Trading Solution', group: 6 },
  { staffId: '43852188', name: 'Hansen Chen', dept: 'GPB&W TRADING SOLUTIONS_GZ', group: 7 },
  { staffId: '45205742', name: 'Ruby H Gu', dept: 'International & Premier', group: 8 },
  { staffId: '34051742', name: 'Vivi Liang', dept: 'WPB', group: 9 },
  { staffId: '43860640', name: 'Ken Feng', dept: 'IWPB', group: 9 },
  { staffId: '45422677', name: 'Nim J N Jiang', dept: 'Wealth Management', group: 1 },
];

exports.main = async (event, context) => {
  const col = db.collection('users');
  const results = { added: [], skipped: [], errors: [] };

  for (const user of USERS) {
    try {
      const { total } = await col.where({ staffId: user.staffId }).count();
      if (total > 0) {
        results.skipped.push(user.staffId);
        continue;
      }
      await col.add({
        data: {
          staffId: user.staffId,
          name: user.name,
          dept: user.dept || '',
          group: user.group || null,
          roles: Array.isArray(user.roles) ? user.roles : ['user'],
          createdAt: db.serverDate(),
        },
      });
      results.added.push(user.staffId);
    } catch (err) {
      results.errors.push({ staffId: user.staffId, error: err.message });
    }
  }

  console.log('初始化完成：', results);
  return {
    success: true,
    message: `新增 ${results.added.length} 条，跳过 ${results.skipped.length} 条，失败 ${results.errors.length} 条`,
    details: results,
  };
};
