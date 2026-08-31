# LEXICON DUEL（CET-6 单机卡牌背词游戏）

这是一个基于 React、TypeScript 和 Vite 的本地浏览器卡牌背词游戏：用 CET-6 词卡答题战斗，击败敌人，在对战中记住单词。每个单词都会以"识义题"和"拼写题"两张卡出现，词性决定卡牌效果，频率等级决定卡牌强度；答题记录、复习记忆和战斗残局全部保存在浏览器 `localStorage`，无需后端。

详细数值规则见 [GAME_RULES.md](./GAME_RULES.md)。

## 功能特性

- **双面词卡**：识义题 5 选 1 选释义；拼写题从首字母开始拼写单词。
- **词性定效果**：动词=攻击、名词=护盾、形容词=强化、副词=抽牌、其余=回复。
- **频率定强度**：L1～L5 频率等级决定卡牌数值，拼写面效果 ×1.25。
- **三种玩法**：学习（60 张卡组战役）、练习（全词库 + 四新一旧复习混入）、错题本（到期复习 + 错题练习）。
- **记忆复习系统**：青铜 → 白银 → 黄金 → 已掌握四品质间隔复习，局内重现，错题加权抽牌。
- **角色与战役**：11 名角色技能、5 名敌人战役（成长、无视护盾、复活、即死等机制）。
- **本地账号**：多账号数据隔离，支持导出/导入 JSON。
- **单词发音**：本地 MP3 + 浏览器语音兜底。

## 本地运行

需要 Node.js 18 或更高版本。在项目根目录执行：

```bash
npm install
npm run dev
```

然后打开终端显示的本地地址，通常是：

```text
http://localhost:5173/
```

如果 5173 端口被占用，Vite 会自动选择其他端口。

## 测试与构建

```bash
npm test        # 运行单元测试（Vitest）
npm run build   # 类型检查 + 生产构建，输出到 dist/
```

生产文件生成在 `dist/` 目录；开发时修改 `src` 文件后浏览器会自动刷新。

## 技术栈

- React 19 + TypeScript
- Vite 8（构建）/ Vitest 4（测试）
- lucide-react（图标）

## 目录结构

```text
.
├─ config/
│  ├─ vite.config.ts             # Vite 开发与生产构建配置
│  └─ typescript/                # TypeScript 工程配置（app / node）
├─ public/
│  └─ library/
│     ├─ cards/cet6_cards.json   # CET-6 词卡数据（10,341 词条）
│     ├─ campaigns.json          # 战役敌人配置
│     ├─ characters.json         # 角色配置
│     └─ avatars/                # 角色与敌人头像
├─ src/
│  ├─ frontend/                  # React 页面、战斗交互与样式（GameApp.tsx / app-styles.css）
│  ├─ battle/                    # 战斗规则、答题引擎、发音（battle-rules.ts / question-engine.ts / pronunciation.ts）
│  ├─ library/                   # 词卡清洗、抽牌、学习卡组生成（card-library.ts / study-decks.ts）
│  ├─ accounts/                  # 本地账号、复习记录、记忆档案、战斗存档（account-manager.ts / local-progress.ts）
│  └─ shared/                    # 跨模块共享数据类型（domain-types.ts）
├─ tools/
│  └─ audio/gen_audio.py         # 生成本地单词 MP3 的脚本
├─ package.json                  # npm 依赖与运行脚本
├─ README.md                     # 项目介绍（本文档）
├─ GAME_RULES.md                 # 详细游戏规则
└─ .gitignore
```

`dist/`、`node_modules/` 是生成或本地依赖目录，已被 Git 忽略。

## 常用修改位置

### 战斗数值

打开 `src/battle/battle-rules.ts`，可以修改：

- `MAX_HAND`：手牌上限（默认 8）。
- `TURN_DRAW`：每回合抽牌数（默认 5）。
- `TURN_ENERGY`：每回合行动力（默认 3）。
- `WRONG_DAMAGE`：答错/放弃惩罚（默认 2）。
- `FULL_HAND_DAMAGE`：手牌溢出每张惩罚（默认 2）。
- `SPELLING_BONUS_MULTIPLIER`：拼写面效果加成（默认 1.25）。
- `effectDescription` 与 `applyCardEffect`：卡牌效果说明与实际结算，修改时必须同步更新。

### 角色与技能

角色统一配置在 `public/library/characters.json`，每个角色可配置 `maxHp`、初始 `shield`、`avatar` 与多个被动/主动技能。当前提供 11 名角色（EMA、ANAN、SHERRY、HANNA、MERURU、NANOKA、MARGO、MIRIA、ALISA、COCO、LEIA）。修改 `selectedCharacterId` 可切换默认角色。

### 敌人与战役

敌人配置在 `public/library/campaigns.json`，支持 10 种技能模板：每回合护盾、攻击成长、初始护盾、每回合回复、狂暴、固定追加伤害、破盾、无视护盾、复活、即死。当前标准敌人组：

| 序 | 敌人 | 昵称 | 生命 | 攻击 | 技能 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | WARDEN | 典狱长 | 38 | 4 | — |
| 2 | JAILER | 学姐 | 50 | 5 | 每 3 回合攻击 +1 |
| 3 | HANOKA | 穗乃香 | 55 | 6 | 攻击无视护盾（冷却 2） |
| 4 | HIRO | 二阶堂 | 63 | 7 | 死亡时以 50% 生命复活（冷却 10） |
| 5 | YUKI | 雪（最终） | 76 | 8 | 每回合 +3 护盾；第 15 回合即死 |

新增技能时需要同时扩展 `src/shared/domain-types.ts` 的联合类型、`src/library/card-library.ts` 的配置校验和 `src/battle/battle-rules.ts` 的结算逻辑。

### 词性效果映射

打开 `src/library/card-library.ts` 中的 `effectForPos`，可以调整原始词性到战斗效果的映射。

### 答题逻辑

打开 `src/battle/question-engine.ts`：

- `buildMeaningQuestion`：生成同词性的识义题选项。
- `buildSpellingQuestion`：生成拼写题。
- `isSpellingCorrect`：判断拼写答案。

答题完成后的结算位于 `src/frontend/GameApp.tsx` 的 `completeAnswer`。

### 词卡数据

词库唯一存放在 `public/library/cards/cet6_cards.json`（10,341 词条），浏览器直接请求该静态文件；程序载入后会进行去重、释义清洗与格式整理，原始 JSON 不会被修改。字段示例：

```json
{
  "cardId": "cet6-00001",
  "word": "ability",
  "phonetic": "/əˈbɪləti/",
  "pos": "n",
  "meaning": "能力；才能",
  "frequencyLevel": 3,
  "frequencyLabel": "中频"
}
```

`frequencyLevel` 必须是 1～5 的整数；`effectType` 无需手动填写，程序会根据 `pos` 自动生成。

### 单词发音

发音采用两层路径：优先播放 `tools/audio/gen_audio.py` 生成的本地 MP3（写入 `public/audio/`，该目录被 Git 忽略），音频缺失或播放失败时自动回落到浏览器 Web Speech API。生成本地音频需要联网且不会在 `dev`/`build` 时自动执行：

```bash
python -m pip install edge-tts
python tools/audio/gen_audio.py
```

可选参数：`--voice en-US-AriaNeural` 更换声音，`--max-level 2` 只生成 L1/L2 词汇。

### 主题与布局

打开 `src/frontend/app-styles.css` 最前面的 `:root`，可修改主要颜色变量：`--bg`（背景）、`--panel`（面板）、`--cream`（主要文字）、`--muted`（辅助文字）、`--cyan`（强调色）、`--orange`（行动力/等级）、`--red`（危险/错误/敌人）、`--blue`（护盾）。

## 本地数据说明

- 账号注册表、复习记录、学习记忆、记忆档案和战斗残局均只保存在当前浏览器的 `localStorage`，不会上传云端；账号导出文件不包含密码。
- 存储键：账号注册表 `lexicon-duel-accounts-v1`；分账号数据 `lexicon-duel-account-v1:<用户>:review|learning|battles|records`（旧键 `lexicon-duel-review-v1`、`lexicon-duel-learning-v1`、`lexicon-duel-battles-v2`）。
- 学习记忆按"卡组 + 词卡"保存，同一词卡出现在不同卡组时可分别完成；练习模式的答题记录与抽牌概率不影响学习模式。
- 清理浏览器网站数据会删除以上记录，词库 JSON 文件不受影响。

## 当前开放内容

已开放：**学习**（卡组战役）、**练习**（全词库 + 复习混入）、**错题本**（到期复习与错题练习）。**联机**模式保留入口，暂未开放。
