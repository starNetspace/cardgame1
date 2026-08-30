# CET-6 单机卡牌背词游戏

这是一个基于 React、TypeScript 和 Vite 的本地浏览器游戏。它使用 CET-6 词卡进行答题和战斗：

- 识义题：根据英文单词选择中文释义。
- 拼写题：根据中文释义，从首字母开始拼写英文单词。
- 词性决定卡牌效果，频率等级决定卡牌强度。
- 答题记录和战斗残局保存在浏览器 `localStorage` 中，不需要后端。

## 本地运行

需要安装 Node.js 18 或更高版本。

在项目根目录执行：

```bash
npm install
npm run dev
```

然后打开终端显示的本地地址，通常是：

```text
http://localhost:5173/
```

如果 5173 端口被占用，Vite 会自动选择其他端口。

## 检查和构建

运行单元测试：

```bash
npm test
```

生成生产版本：

```bash
npm run build
```

生产文件会生成在 `dist` 文件夹中。开发时修改 `src` 文件后，浏览器会自动刷新。

## 目录结构

```text
.
├─ data/
│  └─ cet6_cards.json       # 游戏实际使用的词卡数据
├─ public/
│  └─ data/cet6_cards.json   # Vite 生产构建使用的静态词库副本
├─ src/
│  ├─ App.tsx               # 页面、战斗流程和交互
│  ├─ styles.css            # 全部页面样式和响应式布局
│  ├─ types.ts              # TypeScript 数据类型
│  ├─ main.tsx              # React 入口
│  └─ game/
│     ├─ data.ts             # 词卡清洗、抽牌和卡面生成
│     ├─ questions.ts        # 识义题、拼写题和判题
│     ├─ review.ts           # localStorage 复习记录和残局存档
│     ├─ rules.ts            # 战斗规则和卡牌效果
│     ├─ speech.ts           # 本地 MP3 播放与 Web Speech 兜底
│     ├─ speech.test.ts       # 发音 manifest 查找测试
│     └─ rules.test.ts       # 规则测试
├─ scripts/
│  └─ gen_audio.py           # 本地生成单词 MP3 的脚本
├─ index.html                # HTML 入口和页面标题
├─ package.json              # 依赖和运行脚本
├─ package-lock.json         # 已锁定的依赖版本
├─ tsconfig.json             # TypeScript 总配置
├─ tsconfig.app.json         # 应用 TypeScript 配置
├─ tsconfig.node.json        # Vite 配置的 TypeScript 配置
└─ vite.config.ts            # Vite 配置
```

## 常用修改位置

### 修改战斗数值

打开 `src/game/rules.ts`，可以修改：

- `MAX_HAND`：手牌上限。
- `TURN_DRAW`：每回合抽牌数。
- `TURN_ENERGY`：每回合行动力。
- `WRONG_DAMAGE`：答错惩罚。
- `effectDescription` 和 `applyCardEffect`：卡牌效果说明与实际结算。
- `createBattle`：玩家和敌人的初始属性。

修改效果时需要同时更新 `effectDescription` 和 `applyCardEffect`，确保卡面文字和实际效果一致。

### 修改词性效果

打开 `src/game/data.ts` 中的 `effectForPos`，可以调整原始词性到战斗效果的映射。

### 修改答题逻辑

打开 `src/game/questions.ts`：

- `buildMeaningQuestion` 负责生成相同词性的识义选项。
- `buildSpellingQuestion` 负责生成拼写题。
- `isSpellingCorrect` 负责判断拼写答案。

战斗中答题完成后的效果结算位于 `src/App.tsx` 的 `completeAnswer`。

### 修改词卡数据

编辑词库时修改 `data/cet6_cards.json`。浏览器运行时请求的是 `public/data/cet6_cards.json`，因此修改后需要将编辑源同步复制到这个静态副本，再运行 `npm run dev` 或 `npm run build`。原始数据不会在浏览器中被修改，`src/game/data.ts` 会进行去重、释义清洗和格式整理。

词卡至少需要包含这些字段：

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

其中 `frequencyLevel` 必须是 1 到 5 的整数。`effectType` 不需要手动填写，程序会根据 `pos` 自动生成。

### 单词发音

发音采用两层路径：如果存在由 `scripts/gen_audio.py` 生成的本地 MP3，优先播放本地音频；音频或 manifest 缺失、播放失败时，自动回落到浏览器 Web Speech API。发音按钮只会出现在识义题、答题反馈和词库浏览页，拼写题提交或放弃前不会显示或自动播放。

生成本地音频需要联网，并且不会在 `npm run dev` 或 `npm run build` 时自动执行：

```bash
python -m pip install edge-tts
python scripts/gen_audio.py
```

可选参数：`--voice en-US-AriaNeural` 更换声音，`--max-level 2` 只生成 L1/L2 词汇。生成结果写入 `public/audio/`，该目录会被 Git 忽略；由于 Vite 会将 `public/` 全量复制到 `dist/`，完整音频库可能占用几十 MB，长期维护可考虑 Git LFS。edge-tts 适合个人学习使用；若未来公开分发，建议改用 Azure TTS 付费层并确认授权。

脚本完成后，可重点检查这些词的音频：

- 异音词 10 个：`lead`、`record`、`live`、`present`、`increase`、`object`、`content`、`minute`、`refuse`、`project`
- 缩写词 5 个：`CEO`、`UFO`、`NGO`、`GDP`、`AIDS`
- 复杂辅音簇词 5 个：`strengths`、`scripts`、`texts`、`glimpsed`、`twelfths`
- 高频普通词 10 个：`ability`、`abandon`、`achieve`、`affect`、`allow`、`approach`、`benefit`、`concern`、`develop`、`environment`

以上是定向试听建议，当前实现环境无法试听生成的音频。

### 修改主题和布局

打开 `src/styles.css` 文件最前面的 `:root`，可以修改主要颜色变量：

- `--bg`：页面背景。
- `--panel`：面板背景。
- `--cream`：主要文字。
- `--muted`：辅助文字。
- `--cyan`：主要强调色。
- `--orange`：行动力和等级强调色。
- `--red`：危险、错误和敌人颜色。
- `--blue`：护盾颜色。

## 本地数据说明

复习记录使用浏览器存储键 `lexicon-duel-review-v1`。

按模式保存的残局使用浏览器存储键 `lexicon-duel-battles-v2`，目前支持学习、练习和联机三个独立存档槽位。清理浏览器网站数据会删除这些记录；词库 JSON 文件不会受到影响。

学习模式的独立记忆使用 `lexicon-duel-learning-v1`。学习卡组按 30 张一组生成，每组拆成 5 个 6 张小组；普通卡组优先使用 L1/L2 高频侧和 L3 中频词，未纳入普通组的卡片进入低频卡组，月份、国家/国籍和天气主题卡组可以与普通卡组重叠。学习记忆按“卡组 + 词卡”保存，因此同一张词卡出现在不同卡组时可以分别完成。练习模式的答题记录和抽牌概率不会与学习模式互相影响。

## 当前开放内容

目前开放“学习”和“练习”模式：学习模式从卡组选择页进入，按所选卡组记录答题进度并支持独立残局；练习模式从全部有效 CET-6 词卡中随机抽取。联机模式保留入口，目前暂未开放。
