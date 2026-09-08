# 看谁抢得多 · 听力拼手速抢食物大作战

一款手机端卡通 Q 版 H5 小游戏：听录音、拼手速，1 秒内抢到正确食物就得分，点错或超时食物会被人机抢走，9 个食物抢完后结算，抢得多者获胜。

- 🎮 **在线试玩**：<https://mrcrbox.github.io/food-grab-game/>
- 📦 **源码仓库**：<https://github.com/mrcrbox/food-grab-game>
- 🛠 **技术栈**：TypeScript + HTML5 + CSS3，纯静态页面，无后端、无第三方运行时依赖

---

## 一、玩法规则

1. 开始后先 **3-2-1 倒计时**，随后进入抢食物环节。
2. 画面中央是 **3×3 网格**，9 种食物（牛奶、鸡蛋、面包、芒果、苹果、桃子、青椒、胡萝卜、南瓜）位置每局随机排列。
3. 每轮播放一种食物的**中文语音播报**，玩家需在 **1 秒内**点击对应食物：
   - ✅ **点对**：食物沿抛物线飞向玩家头像，玩家得 1 分；
   - ❌ **点错**：该格显示红色大叉，正确食物飞向人机头像，人机得 1 分；
   - ⏱ **超时**：1 秒内未点，食物被人机抢走，人机得 1 分。
4. 9 个食物全部抢完后进入**结算页**（黄蓝 VS 面板），比较双方数量：玩家多则胜利，少则失败，相等为平局。

## 二、目录结构

```
001/
├── index.html          # 页面结构（标题 / 提示胶囊 / 3×3 网格 / 底部比分栏 / 结算弹窗）
├── css/
│   └── style.css       # 卡通 Q 版样式、动画、手机竖屏适配（含安全区 env）
├── ts/
│   └── game.ts         # TypeScript 源码（状态机 + 音频系统 + 游戏逻辑）
├── js/
│   └── game.js         # tsc 编译产物（页面实际引用）
├── img/                # 图片素材：9 种食物、玩家/机器人头像、红叉、VS 面板、按钮条
├── audio/              # 音频素材：9 个食物播报 mp3 + 4 个音效 mp3
├── package.json        # 脚本命令
└── tsconfig.json       # TypeScript 配置（strict，target ES2020）
```

## 三、本地运行

需要 Node.js（含 npm）。

```bash
# 1. 安装 TypeScript（首次）
npm install

# 2. 编译 TS -> JS
npm run build      # 一次性编译
npm run watch      # 开发时监听自动编译

# 3. 启动本地静态服务器
npm start          # 等同于 python3 -m http.server 8080
```

浏览器打开 <http://localhost:8080> 即可。手机真机测试：手机与电脑连同一 WiFi，访问 `http://<电脑局域网IP>:8080`。

> 注意：音频需要在**用户点击手势**后才能播放（浏览器自动播放策略），直接打开页面不点按钮不会有声音，属正常现象。

## 四、一键部署（GitHub Pages）

项目已配置 GitHub Pages，源码推送到 `main` 分支后约 1 分钟自动更新线上页面。

```bash
npm run deploy
```

该命令会自动依次执行：**tsc 编译 → git add → 自动提交（有改动才提交）→ git push**。
推送后访问 <https://mrcrbox.github.io/food-grab-game/> 即可看到最新版本。

手动部署等价命令：

```bash
npm run build
git add -A
git commit -m "deploy: update game"
git push
```

部署到其他静态托管（Netlify / Vercel / 腾讯云 CloudBase / 自己的 Nginx）时，只需上传以下 5 项（`ts/`、`package.json` 等为开发文件，不需要）：

```
index.html   css/   js/   img/   audio/
```

## 五、音频说明

所有音频位于 `audio/`，页面加载时预加载，并在首次点击手势内静音播放一次完成移动端解锁：

| 场景 | 文件 |
| --- | --- |
| 播报：牛奶 / 鸡蛋 / 面包 / 芒果 / 苹果 / 桃子 / 青椒 / 胡萝卜 / 南瓜 | `milk.mp3` `egg.mp3` `bread.mp3` `mango.mp3` `apple.mp3` `peach.mp3` `pepper.mp3` `carrot.mp3` `pumpkin.mp3` |
| 点对食物 | `select.mp3`（选中） |
| 点错 / 超时被抢 | `wrong.mp3`（错误音效） |
| 结算输了 | `miss.mp3`（失去机会） |
| 结算赢了 / 平局 | `win.mp3`（游戏成功） |

食物播报采用 **MP3 优先、语音合成（speechSynthesis）兜底**策略：MP3 加载或播放失败时自动回退到浏览器中文 TTS，保证任何环境下都有语音提示。1 秒反应计时从播报音频**真正开口**时开始（另设 900ms 兜底，异常也不会卡住流程）。

## 六、实现要点

- **状态机**：`menu（菜单）→ countdown（321 倒计时）→ playing（9 轮抢食物）→ result（结算）`。
- **食物飞行**：使用 Web Animations API 做抛物线飞行 + 缩放消失动画。
- **反应计时**：`requestAnimationFrame` 驱动提示胶囊内 1 秒进度条，超时自动结算。
- **移动端适配**：竖屏布局、`viewport-fit=cover`、安全区 `env(safe-area-inset-*)`、`pointerdown` 触摸响应、禁用双击缩放。
- **图片/音频路径**：全部使用项目内相对路径（`img/xxx.png`、`audio/xxx.mp3`），素材文件名为 ASCII。

## 七、常见问题

- **手机没声音？** 必须先点"开始游戏"按钮（手势解锁音频）；若系统静音或浏览器禁用了媒体自动播放，检查手机音量与浏览器权限。
- **`git push` 提示连接超时？** 网络波动，重试 `git push` 即可；可用 `git status -sb` 确认本地与远端是否已同步（显示 `## main...origin/main` 无 ahead/behind 即已同步）。
- **改了 TS 没生效？** 页面引用的是 `js/game.js`，改完 `ts/game.ts` 后需先 `npm run build`（或用 `npm run watch`）。
