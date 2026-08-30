# 交付记录：练习流程混入复习卡（四新一旧）+ 错题本内复习功能

## 0. 现状清单（开工时）

- 技术栈：React 19 + TypeScript + Vite 8，测试 Vitest 4。
- 词库 `data/cet6_cards.json`，约 10341 张；卡片字段 `cardId/word/pos/meaning/phonetic/frequencyLevel`。
- 已存在 `CardMemoryRecord(cardId/quality/streak/dueAt/history/lapses)` 数据层与 `updateCardMemory` 记账函数，但旧间隔表与本规格不符。
- 旧间隔表（需替换）：`bronze:[4h,1d,3d] silver:[1d,3d,7d,14d] gold:[30d,60d,90d] mastered:[90d,180d]`，且为 1-based、升级不归零 streak。
- 存档按用户隔离：`lexicon-duel-account-v1:<user>:records`，已带用户前缀，无需迁移。
- 无 `getDueCards(now)`，仅有 `getCardMemorySummary`（含 due 计数）。
- 发音模块 `speech.ts` 已上线；拼写题在未答状态本就无发音入口（CardView 仅 meaning 显示发音按钮，QuestionModal 拼写分支无发音）。
- 无组件渲染测试能力，需安装 `@testing-library/react` + `jsdom`。

## 1. 决策记录（依据 §3 裁决协议）

1. **`applyAnswer` 等价物**：代码库中记账纯函数是 `updateCardMemory`。为它增加 `source` 与 `rng`，采用 options 对象形参 `{ abandoned, source, rng }` 保持向后兼容。依据：§3.1.5 + §4.1「review.ts」。
2. **间隔表替换**：整体替换旧 `CARD_MEMORY_INTERVALS` 为规格 §6.1 表，`bronze:[0,1,2,4] silver:[7,10,14,21] gold:[21,30,45] mastered:[60,90]`，`0` 表示「当日稍后」。依据：§3.1.5。
3. **0-based 语义**：`streak` 为等级内连对次数，升级/降级/答错一律归零；取表项用 `intervals[min(streak, len-1)]`。依据：§6.2.2/§6.2.3。
4. **mastered 恒定 90 天**：表 `[60, 90]`，`streak>=1` 钳制到 index 1，无升级。依据：§6.2.5。
5. **时间边界**：新增纯函数 `sameDayDueAt`（当天 23:59 − 随机 0~2h，深夜顺延次日 06:00~09:00）与 `crossDayDueAt`（±10% 抖动 + 目标日 00:00 + 随机 6~18h），统一 `Math.max(due, now+30min)` 下限。依据：§6.4。
6. **「局末未消化转当日稍后」与「降级间隔」并存**：答错时刻按 §6.3 降级取新等级第 0 项；局末对仍在重现队列未重出的卡调用 `settleUnshownRequeue` 将 `dueAt` 覆盖为「当日稍后」。两者均为规格字面要求，故都实现；已记录该张力。建议：若后续认为冲突，可让 settle 仅作用于 bronze。
7. **老数据迁移**：`normalizeCardMemoryRecord` 读档时 `streak = min(streak, 表长-1)` 截断，不补升级、不回退，过期 `dueAt` 视为已到期。依据：§6.5。
8. **四新一旧注入点**：在手牌抽取（`dealHand`）时注入；保留原 `drawCards` 加权抽题（§4.2 行为守恒），并把到期卡从新题池排除以避免同卡双通道重复。依据：§7.1 + §7.5 + §4.2。
9. **错题本复习局**：`BattleState` 新增 `reviewRun?: boolean`；复用练习战斗界面，敌人 `attack:0`、高生命值，四新一旧停用、局内重现生效，20 张到期卡组卷。依据：§8.3/§8.4。
10. **复习局中断不保留断点**：`battle.reviewRun` 时跳过 `saveBattleState` 自动落盘，`exitBattle` 直接丢弃未答部分。依据：§8.6。
11. **cardMeta 以 cardId 为键**：同一卡在同一手牌中最多出现一次（due 通道 1 次、重现先后错开），故用 `cardId` 而非 `instanceId` 关联来源/品质；放弃 instanceId 是因为 `drawTurnCards` 内部生成 instanceId 无法对齐。依据：§3.1.4 简单优先。
12. **测试库固定版本**：`@testing-library/react@16.3.3`、`@testing-library/dom@10.4.1`、`jsdom@26.1.0`，用 `--save-exact` 固定，无 `^/~`。依据：§9.3。
13. **错题本「筛选范围」**：当前记忆档案视图无筛选器，故「当前筛选范围」=全部记忆档案；`getDueCards(store, now, limit)` 预留 `limit` 形参以兼容后续筛选。依据：§3.1.4 + §8.2。
14. **品质-题型匹配 / 学习板块首见建档**：留待后续任务，本期 `updateCardMemory` 的 options.source 接口兼容后续扩展。依据：§10.5。

## 2. 文件级变更清单（对应 §4.1 允许范围）

| 文件 | 变更 | 归属 |
|---|---|---|
| `src/types.ts` | 新增 `CardMemoryAnswerSource`、`CardSource`、`RequeueScheduled`、`ReviewSession`；`BattleState` 增 `reviewRun?` | types.ts 新增类型 |
| `src/game/review.ts` | 重写间隔表与 `updateCardMemory`（source/rng）、新增时间纯函数、`getDueCards/getDueCardIds/getNextDueAt/dueCardCount`、`createReviewSession/recordAnswer/planDeal/settleUnshownRequeue`、迁移截断 | review.ts 复习记录模块 |
| `src/App.tsx` | 四新一旧注入、复习角标、source 记账分流、重现反馈文案、错题本「开始复习」、复习局与小结、空态文案、发音红线（拼写无发音入口）、导出 `CardView/QuestionModal` 供测试 | 练习出题流程 / 错题本页面 / 复习题角标 / 重现反馈文案 / 开始复习按钮 / 复习局末小结 |
| `src/styles.css` | 复习角标、品质色边框、错题本复习按钮、空态提示样式 | 复习题角标 / 品质色边框 |
| `src/game/review-record.test.ts` | 重写为 §6.3 推演、降级、时间边界、记账分流、迁移测试 | 单元测试 |
| `src/game/review-session.test.ts` | 新增四新一旧/重现/去重/局末结算测试 | 单元测试 |
| `src/App.test.tsx` | 新增发音红线 DOM 断言测试 | 组件渲染测试依赖（§9.3 授权） |
| `package.json` / `package-lock.json` | 固定版本安装测试库 | 组件渲染测试依赖 |

## 3. 测试与构建输出摘要

- `npm test`：**9 个文件、74 个测试全部通过，0 失败**（改动前 7 文件 / 54 测试）。
- `npm run build`：**0 错误**（`tsc -b && vite build` 通过）。

新增测试覆盖（对应 §9.2）：
- 四新一旧节奏：有/无到期卡两种；到期取 `dueAt` 最早。
- 计数器局内态：新局从 0 开始；重现题不增减计数。
- 间隔表完整推演（§6.3 逐级断言 dueAt 的 day offset，含四等级每项）。
- 升级/降级：达阈值立即升级取新等级第 0 项；bronze 答错保持 bronze；mastered 恒定 90 天；跌回 gold 21 天。
- 时间边界：不早于 now+30min；深夜顺延 06:00~09:00；抖动不作用于当日稍后；超期答对不惩罚。
- 记账分流四场景（due 对/错、requeue 对/错）+ `lapses` 仅 due 累加。
- 局内重现：5~8 题、单卡上限 2、局末转当日稍后。
- 单局去重：due 通道单卡 1 次；重现队列卡不被 due 选中。
- 迁移：streak 截断、不补升级。
- 发音红线：复习卡/重现卡拼写题未答状态（手牌与弹窗）DOM 断言无发音元素（§9.3）。

## 4. 人工烟测清单（**待用户执行**，未做自动/真机验证）

1. **四新一旧节奏与复习角标**：练习模式开新局，观察每 5 张手牌第 5 张为带「复习」角标 + 品质色边框的到期卡；无到期卡时全部为新题。
2. **局内重现与反馈文案**：本局答错一卡，5~8 题后以「重现」角标重现；重现答对反馈「这次记住了，今晚再见。」，重现答错不显示降级动效。
3. **错题本复习全流程与空态**：错题本头部「开始复习（N）」按钮，N=到期总数；点击进入复习局，局末小结显示「复习 N / 升级 M / 跌落 K」；无档案显示「暂无复习卡片，答错的单词会出现在这里。」；有档案未到期显示「下次到期：X」。
4. **切换用户后记录隔离**：新建/切换账号后，记忆档案与到期卡互不可见。
5. **窄屏 390×844 与 375×667**：复习角标、品质边框、错题本复习按钮不溢出、可点击。

## 5. 遗留说明

- 品质-题型匹配、学习板块首见建档：留待后续任务，本期接口 `updateCardMemory(store, id, face, correct, now, { source, rng })` 兼容后续扩展。
- 运维观察点：若错题本「今日到期」持续只涨不跌，说明到期卡产生速度 > 消化速度；首个可调参数是混入比例 `4:1 -> 3:1`（`planDeal` 的 `newSinceReview >= 4` 阈值），只改一个常数，不动间隔表与记账逻辑。
