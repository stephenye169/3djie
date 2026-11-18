# GLB 模型目录（预留）

按 README「接入真实 GLB 模型」章节使用：

- **按建筑替换**：`public/models/cafe.glb` 等，配合 `layout.js` 的 `model` 字段逐栋加载（失败自动回退程序化建筑）
- **整场景替换**：`public/models/street.glb`，通过 `?glb=/models/street.glb` URL 参数启用

目录当前为空（仅此占位文件）；放入 GLB 后由 `WorldLoader._resolveGlbUrl()` / `layout.model` 读取。
