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
  { staffId: '43868587', name: 'William Xiao(group 2)', dept: 'GFX', group: 2 },
  { staffId: '43361890', name: 'Mark Chen(group 3)', dept: 'Transaction Banking', group: 3 },
  { staffId: '45135550', name: 'Sunson H Q Zhang(group 4)', dept: 'Transaction Banking', group: 4 },
  { staffId: '45087840', name: 'Guo Liang Su(group 5)', dept: 'Transaction Banking', group: 5 },
  { staffId: '45081832', name: 'Audrey K H Yang(group 6)', dept: 'Transaction Banking', group: 6 },
  { staffId: '45482018', name: 'Olivia Wan(group 7)', dept: 'Transaction Banking', group: 7 },
  { staffId: '43408878', name: 'Joy Li(group 8)', dept: 'WPS', group: 8 },
  { staffId: '43561658', name: 'Wier Yang(group 9)', dept: 'iWPB', group: 9 },
  { staffId: '45151788', name: 'Jim Wang(group 2)', dept: 'Transaction Banking', group: 2 },
  { staffId: '43687304', name: 'Ivy He(group 3)', dept: 'IWPB', group: 3 },
  { staffId: '45247009', name: 'Vicky Yan Liang(group 1)', dept: 'Transaction Banking', group: 1 },
  { staffId: '43457407', name: 'Yuanqin Liu(group 4)', dept: 'Transaction Banking', group: 4 },
  { staffId: '43933878', name: 'Hong Min Plery Si Tu(group 5)', dept: 'WPB', group: 5 },
  { staffId: '45379795', name: 'Eric Lin(group 6)', dept: 'GFX', group: 6 },
  { staffId: '43540068', name: 'Eleven Qin(group 7)', dept: 'IWPB Transaction Banking', group: 7 },
  { staffId: '45417277', name: 'Chun Du(group 8)', dept: 'Transaction bank C&R', group: 8 },
  { staffId: '45482297', name: 'Jack Lau(group 9)', dept: 'IWPB', group: 9 },
  { staffId: '45460893', name: 'Chris Yu Chen(group 2)', dept: 'GFX', group: 2 },
  { staffId: '34069066', name: 'Sunny You(group 3)', dept: 'Transaction Banking', group: 3 },
  { staffId: '45461188', name: 'Antonio Huang(group 4)', dept: 'Lending (UNSECURED LENDING + SECURED LENDING)', group: 4 },
  { staffId: '43800323', name: 'Ning Lei(group 5)', dept: 'Lending (UNSECURED LENDING + SECURED LENDING)', group: 5 },
  { staffId: '45270641', name: 'Yansen Z Q Yang(group 6)', dept: 'Lending', group: 6 },
  { staffId: '34802151', name: 'Mandy Wu(group 7)', dept: 'International & Premier', group: 7 },
  { staffId: '43946391', name: 'Linda Lin(group 8)', dept: 'International & Premier', group: 8 },
  { staffId: '45299420', name: 'Mingcong Chen(group 1)', dept: 'International & Premier', group: 1 },
  { staffId: '43580821', name: 'Bruce X J Ou(group 3)', dept: 'WPB', group: 3 },
  { staffId: '43467384', name: 'Yoland Liang(group 1)', dept: 'Iwpb', group: 1 },
  { staffId: '43545517', name: 'Kinson Deng(group 6)', dept: 'FCS', group: 6 },
  { staffId: '43950153', name: 'Jin Rong Jenny Zhuang(group 2)', dept: 'FCS (FRAUD + DECISIONING + COLLECTIONS)', group: 2 },
  { staffId: '43683330', name: 'Nancy J H Liu(group 3)', dept: 'Fraud - Card', group: 3 },
  { staffId: '45482019', name: 'Shane Hui(group 4)', dept: 'Accounts', group: 4 },
  { staffId: '45106720', name: 'Eva Yih(group 5)', dept: 'Accounts', group: 5 },
  { staffId: '45481996', name: 'Yuki Xue(group 7)', dept: 'Accounts', group: 7 },
  { staffId: '45381041', name: 'Hao Chen(group 8)', dept: 'SPS (STRAT. PGM & SERV. RESILIENCE)', group: 8 },
  { staffId: '34051619', name: 'Rui Qi Wang(group 9)', dept: 'iwpb', group: 9 },
  { staffId: '43909091', name: 'Cecilia Qin(group 1)', dept: 'SPS (STRAT. PGM & SERV. RESILIENCE)', group: 1 },
  { staffId: '43959541', name: 'Carlos Yong Chen(group 1)', dept: 'Wealth Management', group: 1 },
  { staffId: '43663760', name: 'Derek Liu(group 2)', dept: 'Wealth Management', group: 2 },
  { staffId: '45041540', name: 'Jun Li(group 3)', dept: 'WPS CTO', group: 3 },
  { staffId: '43167017', name: 'Crystal Hu(group 4)', dept: 'WPB', group: 4 },
  { staffId: '34065817', name: 'Benson J B Liang(group 5)', dept: 'Wealth Management', group: 5 },
  { staffId: '45043670', name: 'Taylor Wang(group 6)', dept: 'Wealth CTO', group: 6 },
  { staffId: '45042694', name: 'Michael Shen(group 1)', dept: 'Wealth Management', group: 1 },
  { staffId: '43457731', name: 'Kitty Li(group 7)', dept: 'Wealth Solutions', group: 7 },
  { staffId: '44001013', name: 'Rachel Q J LV(group 8)', dept: 'Wealth Management', group: 8 },
  { staffId: '43733299', name: 'Don Lu(group 9)', dept: 'Wealth Management', group: 9 },
  { staffId: '45211802', name: 'Griffin Mai(group 2)', dept: 'Wealth Management', group: 2 },
  { staffId: '43631229', name: 'Lucia X M Zhu(group 4)', dept: 'Wealth Management', group: 4 },
  { staffId: '45029676', name: 'Lucia M J Cai(group 5)', dept: 'Wealth Management', group: 5 },
  { staffId: '45454233', name: 'Eason Cheng(group 6)', dept: 'DIGITAL SOLUTIONS', group: 6 },
  { staffId: '45190082', name: 'Joako Feng(group 7)', dept: 'WPB', group: 7 },
  { staffId: '43227720', name: 'Greeny Chen(group 8)', dept: 'Wealth CTO', group: 8 },
  { staffId: '43170460', name: 'Winland W L Mai(group 9)', dept: 'Wealth Management', group: 9 },
  { staffId: '45043450', name: 'Fred Long(group 1)', dept: 'DIGITAL SOLUTIONS', group: 1 },
  { staffId: '43427655', name: 'Yippee Huang(group 2)', dept: 'Wealth Management', group: 2 },
  { staffId: '43445199', name: 'Novo Q Y LI(group 3)', dept: 'Wealth Management', group: 3 },
  { staffId: '45164126', name: 'Stephen Zhang(group 4)', dept: 'Wealth Management', group: 4 },
  { staffId: '43972641', name: 'Vincent W X Huang(group 5)', dept: 'IWPB', group: 5 },
  { staffId: '43334616', name: 'Tony Cheng(group 6)', dept: 'Trading Solution', group: 6 },
  { staffId: '43604841', name: 'Wing Xie(group 7)', dept: 'CTO', group: 7 },
  { staffId: '45463737', name: 'Bo Deng(group 8)', dept: 'Wealth Management', group: 8 },
  { staffId: '45269184', name: 'Caroline J W Zhang(group 9)', dept: 'Wealth CTO', group: 9 },
  { staffId: '45169514', name: 'Mark Su(group 2)', dept: 'Wealth Management', group: 2 },
  { staffId: '45489768', name: 'Kim Zhou(group 3)', dept: 'Wealth Management', group: 3 },
  { staffId: '43339625', name: 'Johnson Z S Wei(group 4)', dept: 'IWPB', group: 4 },
  { staffId: '43228393', name: 'Michael Z Wang(group 5)', dept: 'Wealth Management', group: 5 },
  { staffId: '43334290', name: 'Roy Luo(group 6)', dept: 'Trading Solution', group: 6 },
  { staffId: '43852188', name: 'Hansen Chen(group 7)', dept: 'GPB&W TRADING SOLUTIONS_GZ', group: 7 },
  { staffId: '45205742', name: 'Ruby H Gu(group 8)', dept: 'International & Premier', group: 8 },
  { staffId: '34051742', name: 'Vivi Liang(group 9)', dept: 'WPB', group: 9 },
  { staffId: '43860640', name: 'Ken Feng(group 9)', dept: 'IWPB', group: 9 },
  { staffId: '45422677', name: 'Nim J N Jiang(group 1)', dept: 'Wealth Management', group: 1 },
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
