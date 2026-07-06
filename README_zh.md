# PitchMate

[English](README.md)

PitchMate 是一个浏览器里的唱歌练习工具，用来把你的实时演唱音高和参考音频进行对比。

访问地址：https://jliip.github.io/pitchmate/

## 功能

- 上传音频作为参考轨道。
- 在浏览器中提取参考音频的音高曲线。
- 使用麦克风实时对比演唱音高和目标音高。
- 显示当前演唱偏高、偏低，还是接近目标。
- 展示音名、音分偏差、播放进度和基础评分。

## 本地运行

```bash
npm install
npm run dev
```

请使用 Chrome 或 Edge 打开本地 Vite 地址。麦克风权限需要安全上下文，`localhost` 可以正常使用。

## 部署

项目已按 GitHub Pages 配置，线上地址为：

```text
https://jliip.github.io/pitchmate/
```

构建命令：

```bash
npm run build
```