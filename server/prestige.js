/**
 * 资本轮回（Prestige）：
 *
 *   POST /api/game/prestige   达到 500 亿总身价后清零重生，换传世黑卡点数
 *   POST /api/game/talents    消耗黑卡点数点亮永久天赋（各 5 级）
 *
 * 轮回内容：
 *   - 结算租金 → 删除 player_shops 全部持有（资产回归无主）
 *   - 现金清零、rebirth_count +1、black_card_points += 身价/5亿
 *   - income_per_sec / title 由 syncDerived 归零重算（街头路人甲）
 *   - 任务进度、拾取冷却、碰瓷冷却保留（防刷机制不重置）
 *   - 有进行中的踢馆（攻/守任一方）时禁止轮回，先打完
 */
import express from 'express';
import { query, run } from './db.js';
import { authMiddleware } from './auth.js';
import { settle, syncDerived, listOwned, assetValue } from './economy.js';
import { broadcastBattle } from './chat.js';
import { incomingAttack } from './capital.js';
import { findAsset, formatMoney, PRESTIGE_THRESHOLD } from '../shared/assets.js';
import {
  prestigePointsOf, findTalent, talentLevelOf, nextTalentCost, TALENT_MAX_LEVEL,
} from '../shared/prestige.js';

const router = express.Router();

/** 持有资产总身价：Σ 基础价 × 1.5^(等级-1)（buildState 也用） */
export function totalPortfolioValue(userId) {
  return listOwned(userId).reduce((sum, s) => {
    const asset = findAsset(s.shop_id);
    return asset ? sum + assetValue(asset, s.level) : sum;
  }, 0);
}

/** 是否有自己发起、仍在进行中的踢馆（内存 pending 与 shop_attacks 表同步写入，查表即可） */
function hasOutgoingAttack(userId) {
  return query(
    "SELECT id FROM shop_attacks WHERE attacker_id = ? AND status = 'pending' LIMIT 1",
    [userId]
  ).length > 0;
}

function readUser(userId) {
  return query(
    `SELECT id, nickname, balance, rebirth_count, black_card_points, talents_json
     FROM users WHERE id = ?`,
    [userId]
  )[0] || null;
}

/** 轮回：清零重生换黑卡 */
router.post('/prestige', authMiddleware, (req, res) => {
  const userId = req.user.id;
  settle(userId); // 先把挂机租金结清，避免清零后丢失

  const user = readUser(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 攻守任一方有进行中的踢馆都不允许轮回
  if (hasOutgoingAttack(userId)) {
    return res.status(409).json({ error: '你发起的踢馆还没打完，先等它落幕' });
  }
  if (incomingAttack(userId)) {
    return res.status(409).json({ error: '你的店铺正在被踢馆，先护盘再说' });
  }

  const totalValue = totalPortfolioValue(userId);
  if (totalValue < PRESTIGE_THRESHOLD) {
    return res.status(409).json({
      error: `总身价未达 ${formatMoney(PRESTIGE_THRESHOLD)}，还差 ${formatMoney(PRESTIGE_THRESHOLD - totalValue)}`,
      totalValue,
      threshold: PRESTIGE_THRESHOLD,
    });
  }

  const points = prestigePointsOf(totalValue);
  const now = Date.now();

  run('DELETE FROM player_shops WHERE user_id = ?', [userId]);
  run(
    `UPDATE users
     SET balance = 0,
         rebirth_count = rebirth_count + 1,
         black_card_points = black_card_points + ?,
         last_tick = ?,
         last_dividend_at = ?
     WHERE id = ?`,
    [points, now, now, userId]
  );
  syncDerived(userId); // income_per_sec 归 0、称号回落街头路人甲

  const nextRound = Number(user.rebirth_count) + 1;
  broadcastBattle({
    id: `${userId}-${now}`,
    nickname: '资本轮回',
    content: `【资本轮回】玩家【${user.nickname}】亲手清零 ${formatMoney(totalValue)} 帝国，换得 ${points} 张传世黑卡，开启第 ${nextRound} 轮制霸！`,
    ts: now,
  });

  const fresh = readUser(userId);
  res.json({
    ok: true,
    points,
    totalValue,
    rebirthCount: Number(fresh.rebirth_count),
    blackCardPoints: Number(fresh.black_card_points),
  });
});

/** 点亮 / 升级天赋 */
router.post('/talents', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const talent = findTalent(String(req.body?.talentId || ''));
  if (!talent) return res.status(404).json({ error: '天赋不存在' });

  const user = readUser(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const talents = JSON.parse(user.talents_json || '{}');
  const level = talentLevelOf(talents, talent.id);
  if (level >= TALENT_MAX_LEVEL) {
    return res.status(409).json({ error: '【' + talent.name + '】已修炼到顶级' });
  }

  const cost = nextTalentCost(level);
  const have = Number(user.black_card_points) || 0;
  if (have < cost) {
    return res.status(402).json({
      error: `黑卡点数不足，还需 ${cost - have} 张`,
      cost,
      have,
    });
  }

  talents[talent.id] = level + 1;
  run(
    'UPDATE users SET black_card_points = black_card_points - ?, talents_json = ? WHERE id = ?',
    [cost, JSON.stringify(talents), userId]
  );

  res.json({
    ok: true,
    talentId: talent.id,
    level: level + 1,
    cost,
    blackCardPoints: have - cost,
  });
});

export default router;
