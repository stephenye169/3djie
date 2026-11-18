/**
 * 街头碰瓷 NPC（前后端共用）
 *
 * 埋伏在青果巷角落的「势利眼」角色：走近触发对话，选择用钞能力羞辱他，
 * 打脸成功当场爆出巨额金币。位置均落在可行走街道范围内（x ∈ ±3.9）。
 */
export const TAUNT_NPCS = [
  {
    id: 'playboy',
    name: '势利眼富二代',
    place: '城隍庙戏楼后巷',
    avatar: '🕶',
    x: 3.1,
    z: -53,
    reward: 20_000_000,
    cooldownHours: 2,
    greeting: '哟，这不是那个连奶茶铺都买不起的穷鬼吗？站远点，别蹭脏了本少爷的高定西装。',
    success: '他「扑通」一声跪在青石板上：爷！小的有眼不识泰山，这两千万您拿着，求您别收购我家祖宅！',
  },
  {
    id: 'aunt',
    name: '恶毒亲戚',
    place: '赵元任故居门口',
    avatar: '💅',
    x: -3.0,
    z: -191,
    reward: 20_000_000,
    cooldownHours: 2,
    greeting: '听说你也在这条街上混？你爹当年连房租都交不起，你能有什么出息，赶紧把铺子让给你表哥。',
    success: '她脸上的表情从轻蔑变成惊恐：是姑妈嘴贱！这张黑卡里有两千万，你拿去，别跟你表哥一般见识……',
  },
];

export function findTauntNpc(id) {
  return TAUNT_NPCS.find((npc) => npc.id === id) || null;
}
