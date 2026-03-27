# PDF2Book

[English](README.md)

PDF 转在线书架。Fork，阅读，搞定。

> Fork 本仓库即可拥有自己的在线书架。上传 PDF，自动转换为 Markdown，以 GitBook 风格的阅读站点部署在 GitHub Pages 上。零服务器成本。

## 快速开始（3 步）

### 1. Fork 并启用 Pages

1. 点击本仓库的 **Fork** 按钮
2. 在你的 Fork 中，进入 **Settings > Pages**
3. **Source** 选择 **GitHub Actions**
4. 进入 **Actions** 标签页，选择 **Deploy to GitHub Pages**，点击 **Run workflow** 触发首次部署

站点已上线：`https://<your-username>.github.io/pdf2book/`

### 2. 添加 MinerU Token

1. 在 [mineru.net](https://mineru.net) 注册（测试期免费）
2. 复制 API Token
3. 在你的 Fork 中，进入 **Settings > Secrets and variables > Actions**
4. 点击 **New repository secret**，名称填 `MINERU_TOKEN`，粘贴 Token

### 3. 上传第一本书

1. 访问站点，点击顶栏的齿轮图标
2. 输入具有 `repo` 权限的 GitHub **Personal Access Token**
   （[点此创建](https://github.com/settings/tokens/new?scopes=repo&description=PDF2Book)）
3. 上传 PDF 文件
4. 等待转换完成（页面实时显示进度）
5. 书籍出现在书架上！

## 功能

- **阅读器** — 明暗主题、章节侧边栏、键盘导航、代码高亮（Shiki）、数学公式（KaTeX）、响应式布局
- **管理面板** — 浏览器内上传 PDF、实时转换进度、目录管理（编辑、发布、隐藏、归档、删除）、搜索和筛选
- **转换流水线** — GitHub Actions 通过 MinerU API 转换 PDF，大文件自动分块，生成章节和元数据

## 工作原理

```
上传 PDF（浏览器 → GitHub API → input/）
  → GitHub Actions → MinerU API → Markdown
  → 拆分章节 → docs/books/{id}/
  → 构建 manifest → GitHub Pages 部署
```

## 测试

```bash
npm test                                        # JS 单元测试
npm run test:frontend                           # 前端行为测试
python -m unittest discover -s tests/scripts -v # Python 流水线测试
```

## 常见问题

**需要在本地安装什么吗？** 不需要。一切在 GitHub Actions 和浏览器中运行。

**MinerU 收费了怎么办？** 修改 `scripts/mineru_client.py` 即可替换，兼容任何 PDF 转 Markdown 工具。

**可以手动编辑转换后的章节吗？** 可以。编辑 `docs/books/<id>/chapters/` 下的 `.md` 文件并提交即可。

**编辑目录信息后重新转换会丢失吗？** 不会。策展元数据单独存储，重建时自动合并。

## 免责声明

仅供**个人学习和研究**使用。用户需自行确保拥有转换和托管 PDF 内容的合法权利。未经授权请勿上传受版权保护的材料。

## 许可证

MIT
