# 部署指南

**用途**: 说明如何部署 Claude Workflow Toolkit 的安装包和在线安装脚本

**版本**: 1.0.0
**最后更新**: 2025-01-20

---

## 🎯 部署概述

Claude Workflow Toolkit 使用标准的在线安装方式，用户通过以下命令一键安装：

```bash
curl -fsSL https://your-domain.com/install.sh | bash
```

本文档说明如何准备和部署安装所需的资源。

---

## 📦 打包工作流

### 1. 准备源文件

确保您的工具包已完整配置：

```bash
# 验证文件完整性
ls ~/.claude/commands/ | wc -l    # 应该 ≥ 25
ls ~/.claude/docs/ | wc -l         # 应该 ≥ 3
ls ~/.claude/agents/ | wc -l       # 应该 ≥ 3
ls ~/.claude/utils/ | wc -l        # 应该 ≥ 2
```

### 2. 执行打包脚本

```bash
# 运行打包脚本
bash ~/.claude/package.sh
```

**打包产物位置**: `~/.claude/dist/`

```
~/.claude/dist/
├── claude-workflow-toolkit-v1.0.0.tar.gz         # 压缩包
├── claude-workflow-toolkit-v1.0.0.tar.gz.sha256  # 校验和
└── INSTALL.txt                                   # 安装说明
```

### 3. 验证打包结果

```bash
cd ~/.claude/dist

# 检查文件大小
ls -lh claude-workflow-toolkit-v1.0.0.tar.gz

# 验证校验和
shasum -a 256 -c claude-workflow-toolkit-v1.0.0.tar.gz.sha256

# 查看压缩包内容
tar -tzf claude-workflow-toolkit-v1.0.0.tar.gz | head -20
```

---

## 🌐 部署方式

### 方式 1：GitHub Releases（推荐）

**优势**: 免费、稳定、支持版本管理

#### 步骤 1：创建 GitHub 仓库

```bash
# 创建工具包仓库
mkdir claude-workflow-toolkit
cd claude-workflow-toolkit

# 初始化 Git
git init
git remote add origin https://github.com/your-org/claude-workflow-toolkit.git
```

#### 步骤 2：提交必要文件

```bash
# 复制核心文件
cp -r ~/.claude/commands .
cp -r ~/.claude/docs .
cp -r ~/.claude/agents .
cp -r ~/.claude/utils .
cp ~/.claude/install.sh .
cp ~/.claude/init-project.sh .
cp ~/.claude/README.md .
cp ~/.claude/QUICK-START.md .

# 提交
git add .
git commit -m "chore: initial release v1.0.0"
git push -u origin main
```

#### 步骤 3：创建 Release

```bash
# 使用 gh CLI 创建 Release
gh release create v1.0.0 \
  ~/.claude/dist/claude-workflow-toolkit-v1.0.0.tar.gz \
  ~/.claude/dist/claude-workflow-toolkit-v1.0.0.tar.gz.sha256 \
  --title "v1.0.0 - Initial Release" \
  --notes "首次发布"
```

或通过 GitHub 网页：
1. 访问 https://github.com/your-org/claude-workflow-toolkit/releases
2. 点击 "Draft a new release"
3. 创建 tag `v1.0.0`
4. 上传压缩包和校验和文件
5. 发布

#### 步骤 4：更新在线安装脚本

修改 `~/.claude/online-install.sh` 中的下载地址：

```bash
# 修改这一行：
DOWNLOAD_BASE_URL="https://your-domain.com/releases"

# 改为：
DOWNLOAD_BASE_URL="https://github.com/your-org/claude-workflow-toolkit/releases/download/v1.0.0"
```

#### 步骤 5：托管在线安装脚本

**选项 A：使用 GitHub Pages**

```bash
# 在仓库根目录创建 docs/
mkdir -p docs
cp ~/.claude/online-install.sh docs/install.sh

# 提交并启用 GitHub Pages
git add docs/install.sh
git commit -m "chore: add online install script"
git push

# 在 GitHub 仓库设置中启用 Pages（Source: docs/）
# 访问地址：https://your-org.github.io/claude-workflow-toolkit/install.sh
```

**选项 B：使用 jsDelivr CDN**

```bash
# 将在线安装脚本提交到仓库
cp ~/.claude/online-install.sh install.sh
git add install.sh
git commit -m "chore: add install script"
git push

# 通过 jsDelivr 加速访问
# 访问地址：https://cdn.jsdelivr.net/gh/your-org/claude-workflow-toolkit@main/install.sh
```

**选项 C：使用 raw.githubusercontent.com**

```bash
# 直接使用 GitHub 原始文件
# 访问地址：https://raw.githubusercontent.com/your-org/claude-workflow-toolkit/main/online-install.sh
```

#### 最终安装命令

```bash
# GitHub Pages
curl -fsSL https://your-org.github.io/claude-workflow-toolkit/install.sh | bash

# jsDelivr CDN
curl -fsSL https://cdn.jsdelivr.net/gh/your-org/claude-workflow-toolkit@main/install.sh | bash

# GitHub Raw
curl -fsSL https://raw.githubusercontent.com/your-org/claude-workflow-toolkit/main/online-install.sh | bash
```

---

### 方式 2：自建服务器/CDN

**优势**: 完全控制、自定义域名

#### 步骤 1：上传到服务器

```bash
# 使用 scp 上传
scp ~/.claude/dist/claude-workflow-toolkit-v1.0.0.tar.gz* \
    user@your-server.com:/var/www/releases/

scp ~/.claude/online-install.sh \
    user@your-server.com:/var/www/install.sh
```

#### 步骤 2：配置 Web 服务器

**Nginx 配置示例**:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 安装脚本
    location /install.sh {
        alias /var/www/install.sh;
        default_type text/plain;
        add_header Content-Type "text/x-shellscript; charset=utf-8";
    }

    # Release 文件
    location /releases/ {
        alias /var/www/releases/;
        autoindex on;
    }
}
```

**Apache 配置示例**:

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    DocumentRoot /var/www

    <Directory /var/www>
        Options +Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    <FilesMatch "\.sh$">
        Header set Content-Type "text/x-shellscript; charset=utf-8"
    </FilesMatch>
</VirtualHost>
```

#### 步骤 3：设置 HTTPS（推荐）

```bash
# 使用 Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

#### 最终安装命令

```bash
curl -fsSL https://your-domain.com/install.sh | bash
```

---

### 方式 3：企业内网部署

**优势**: 安全、可控、离线支持

#### 步骤 1：内网服务器配置

```bash
# 在内网服务器上创建目录
ssh user@internal-server
sudo mkdir -p /opt/claude-toolkit/{releases,scripts}
```

#### 步骤 2：上传文件

```bash
# 从本地上传
scp ~/.claude/dist/claude-workflow-toolkit-v1.0.0.tar.gz* \
    user@internal-server:/opt/claude-toolkit/releases/

scp ~/.claude/online-install.sh \
    user@internal-server:/opt/claude-toolkit/scripts/install.sh
```

#### 步骤 3：配置内网 HTTP 服务

使用简单的 HTTP 服务器：

```bash
# Python HTTP Server
cd /opt/claude-toolkit
python3 -m http.server 8080

# 或使用 Nginx/Apache
```

#### 步骤 4：更新安装脚本

修改 `install.sh` 中的下载地址：

```bash
DOWNLOAD_BASE_URL="http://internal-server:8080/releases"
```

#### 员工安装命令

```bash
curl -fsSL http://internal-server:8080/scripts/install.sh | bash
```

---

### 方式 4：通过包管理器（未来支持）

**Homebrew（macOS）**:

```ruby
# Formula 示例
class ClaudeWorkflowToolkit < Formula
  desc "Claude Code workflow toolkit"
  homepage "https://github.com/your-org/claude-workflow-toolkit"
  url "https://github.com/your-org/claude-workflow-toolkit/releases/download/v1.0.0/claude-workflow-toolkit-v1.0.0.tar.gz"
  sha256 "..."

  def install
    prefix.install Dir["*"]
  end
end
```

**npm（跨平台）**:

```json
{
  "name": "@your-org/claude-workflow-toolkit",
  "version": "1.0.0",
  "bin": {
    "claude-workflow-install": "./install.sh"
  }
}
```

---

## 🔄 更新发布流程

### 版本更新

```bash
# 1. 更新版本号
# 修改 ~/.claude/package.sh 中的 VERSION="1.0.1"

# 2. 重新打包
bash ~/.claude/package.sh

# 3. 创建新的 GitHub Release
gh release create v1.0.1 \
  ~/.claude/dist/claude-workflow-toolkit-v1.0.1.tar.gz \
  ~/.claude/dist/claude-workflow-toolkit-v1.0.1.tar.gz.sha256 \
  --title "v1.0.1" \
  --notes "Bug fixes and improvements"

# 4. 更新在线安装脚本（如果有变化）
git add online-install.sh
git commit -m "chore: update install script for v1.0.1"
git push
```

### 向后兼容

建议保留多个版本的下载链接：

```bash
# 最新版（指向最新 Release）
https://your-domain.com/install.sh

# 特定版本
https://your-domain.com/releases/v1.0.0/install.sh
https://your-domain.com/releases/v1.0.1/install.sh
```

---

## 📊 监控与分析

### 下载统计

**GitHub Releases**:
- 在 Releases 页面可查看下载次数

**自建服务器**:
```bash
# Nginx 访问日志分析
grep "install.sh" /var/log/nginx/access.log | wc -l
```

### 错误跟踪

在安装脚本中添加可选的匿名统计：

```bash
# 安装成功时上报（需用户同意）
if [ "$ENABLE_ANALYTICS" = "true" ]; then
    curl -X POST https://your-domain.com/api/install-success \
         -d "version=1.0.0&os=$OS_TYPE" \
         -H "Content-Type: application/json"
fi
```

---

## 🔒 安全最佳实践

### 1. 使用 HTTPS

确保安装脚本通过 HTTPS 下载，防止中间人攻击。

### 2. 校验和验证

在线安装脚本已包含 SHA256 校验和验证：

```bash
shasum -a 256 -c "$ARCHIVE_NAME.sha256" --quiet
```

### 3. 代码签名（可选）

使用 GPG 签名压缩包：

```bash
# 生成签名
gpg --detach-sign --armor claude-workflow-toolkit-v1.0.0.tar.gz

# 用户验证
gpg --verify claude-workflow-toolkit-v1.0.0.tar.gz.asc
```

### 4. 内容安全策略

在 Web 服务器上设置适当的 HTTP 头：

```nginx
add_header Content-Security-Policy "default-src 'self'";
add_header X-Content-Type-Options "nosniff";
add_header X-Frame-Options "DENY";
```

---

## 🛠️ 故障排查

### 问题 1：下载失败

**原因**: 网络问题或 URL 不正确

**解决**:
```bash
# 测试下载链接
curl -I https://your-domain.com/install.sh

# 检查服务器日志
tail -f /var/log/nginx/error.log
```

### 问题 2：校验和验证失败

**原因**: 文件损坏或被篡改

**解决**:
```bash
# 重新生成校验和
shasum -a 256 claude-workflow-toolkit-v1.0.0.tar.gz > \
    claude-workflow-toolkit-v1.0.0.tar.gz.sha256
```

### 问题 3：权限问题

**原因**: 服务器文件权限设置不当

**解决**:
```bash
# 设置正确的权限
chmod 644 /var/www/releases/*.tar.gz*
chmod 644 /var/www/install.sh
```

---

## 📚 相关资源

- **打包脚本**: `~/.claude/package.sh`
- **在线安装脚本**: `~/.claude/online-install.sh`
- **依赖检测文档**: `~/.claude/docs/dependency-check.md`
- **GitHub Releases 文档**: https://docs.github.com/en/repositories/releasing-projects-on-github
- **jsDelivr CDN**: https://www.jsdelivr.com/

---

## 📝 部署检查清单

部署前检查：

- [ ] 所有源文件已准备完整
- [ ] 运行打包脚本生成压缩包
- [ ] 验证压缩包校验和
- [ ] 测试解压和安装流程
- [ ] 上传文件到服务器/GitHub
- [ ] 配置 Web 服务器（如需）
- [ ] 启用 HTTPS（推荐）
- [ ] 更新在线安装脚本中的 URL
- [ ] 测试在线安装命令
- [ ] 更新文档中的安装链接
- [ ] 准备发布说明

部署后验证：

- [ ] 下载链接可访问
- [ ] 校验和验证通过
- [ ] 在线安装脚本正常执行
- [ ] 依赖检测正确
- [ ] 工具包安装成功
- [ ] 所有命令可用

---

## 🎯 推荐部署方案

**个人/开源项目**:
- GitHub Releases + GitHub Pages/jsDelivr
- 免费、简单、稳定

**企业项目**:
- 自建服务器 + HTTPS
- 可控、安全、支持内网

**大规模分发**:
- CDN + 多地域镜像
- 高性能、高可用

---

**版本**: 1.0.0
**最后更新**: 2025-01-20
**维护者**: Claude Workflow Toolkit Team
