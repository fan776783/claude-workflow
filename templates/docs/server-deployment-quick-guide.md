# 服务器部署快速指南

**用途**: 快速在服务器上部署 Claude Workflow Toolkit 安装系统

**服务器路径**: `/home/sudo_root/workflow/`

---

## 📋 前置准备

### 文件清单

确保以下文件已上传到服务器 `/home/sudo_root/workflow/`：

```
/home/sudo_root/workflow/
├── online-install.sh                                # 在线安装脚本
├── claude-workflow-toolkit-v1.0.0.tar.gz            # 工具包压缩包
└── claude-workflow-toolkit-v1.0.0.tar.gz.sha256     # 校验和文件
```

### 上传文件到服务器

```bash
# 从本地上传（在本地执行）
scp ~/.claude/online-install.sh \
    sudo_root@your-server:/home/sudo_root/workflow/

scp ~/.claude/dist/claude-workflow-toolkit-v1.0.0.tar.gz* \
    sudo_root@your-server:/home/sudo_root/workflow/
```

---

## 🚀 快速部署（3 步）

### 步骤 1：设置文件权限

SSH 登录服务器后执行：

```bash
# 登录服务器
ssh sudo_root@your-server

# 设置文件权限
chmod 644 /home/sudo_root/workflow/online-install.sh
chmod 644 /home/sudo_root/workflow/claude-workflow-toolkit-v1.0.0.tar.gz
chmod 644 /home/sudo_root/workflow/claude-workflow-toolkit-v1.0.0.tar.gz.sha256

# 验证文件
ls -lh /home/sudo_root/workflow/
```

### 步骤 2：配置 Nginx

#### 方式 A：创建独立配置文件（推荐）

```bash
# 创建配置文件
sudo vim /etc/nginx/conf.d/claude-toolkit.conf
```

**粘贴以下配置**：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为您的域名

    # 安装脚本
    # 访问 URL: http://your-domain.com/install.sh
    location = /install.sh {
        alias /home/sudo_root/workflow/online-install.sh;
        default_type text/x-shellscript;
        add_header Content-Type "text/x-shellscript; charset=utf-8";
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Releases 目录
    # 访问 URL: http://your-domain.com/releases/claude-workflow-toolkit-v1.0.0.tar.gz
    location /releases/ {
        alias /home/sudo_root/workflow/;
        autoindex on;
        autoindex_exact_size off;
        autoindex_localtime on;
        expires 1h;
    }

    # 安全头
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
}
```

#### 方式 B：添加到现有配置

如果您的域名已有 Nginx 配置，在现有 `server` 块中添加：

```bash
sudo vim /etc/nginx/sites-available/your-domain
```

添加以下 location 块：

```nginx
# 在现有 server 块中添加：

location = /install.sh {
    alias /home/sudo_root/workflow/online-install.sh;
    default_type text/x-shellscript;
    add_header Content-Type "text/x-shellscript; charset=utf-8";
    add_header Cache-Control "no-cache";
}

location /releases/ {
    alias /home/sudo_root/workflow/;
    autoindex on;
    expires 1h;
}
```

### 步骤 3：测试并重载 Nginx

```bash
# 测试配置语法
sudo nginx -t

# 如果测试通过，重载配置
sudo nginx -s reload

# 或重启 Nginx
sudo systemctl reload nginx
```

---

## ✅ 验证部署

### 测试 1：访问安装脚本

```bash
# 在服务器上测试
curl -I http://your-domain.com/install.sh

# 应该返回：
# HTTP/1.1 200 OK
# Content-Type: text/x-shellscript; charset=utf-8
```

### 测试 2：访问压缩包

```bash
curl -I http://your-domain.com/releases/claude-workflow-toolkit-v1.0.0.tar.gz

# 应该返回：
# HTTP/1.1 200 OK
```

### 测试 3：浏览器访问

打开浏览器访问：
- http://your-domain.com/install.sh （应该显示脚本内容）
- http://your-domain.com/releases/ （应该显示文件列表）

### 测试 4：完整安装流程

在另一台机器上测试安装（需先修改 online-install.sh 中的 URL）：

```bash
# 先更新 online-install.sh 中的下载地址
# 将第 9 行改为：
DOWNLOAD_BASE_URL="http://your-domain.com/releases"

# 然后测试安装
curl -fsSL http://your-domain.com/install.sh | bash
```

---

## 🔐 启用 HTTPS（强烈推荐）

### 使用 Let's Encrypt（免费）

```bash
# 安装 Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# 获取证书并自动配置 Nginx
sudo certbot --nginx -d your-domain.com

# Certbot 会自动：
# 1. 获取 SSL 证书
# 2. 修改 Nginx 配置
# 3. 设置自动续期
```

### 验证 HTTPS

```bash
# 测试 HTTPS 访问
curl -I https://your-domain.com/install.sh

# 更新安装命令为 HTTPS
curl -fsSL https://your-domain.com/install.sh | bash
```

---

## 📊 监控和日志

### 查看访问日志

```bash
# 查看最近的访问
sudo tail -f /var/log/nginx/access.log

# 统计安装脚本下载次数
sudo grep "install.sh" /var/log/nginx/access.log | wc -l

# 统计压缩包下载次数
sudo grep "claude-workflow-toolkit.*\.tar\.gz" /var/log/nginx/access.log | wc -l
```

### 查看错误日志

```bash
sudo tail -f /var/log/nginx/error.log
```

### 按日期统计下载

```bash
# 今天的下载次数
sudo grep "$(date +%d/%b/%Y)" /var/log/nginx/access.log | \
    grep "claude-workflow-toolkit.*\.tar\.gz" | wc -l
```

---

## 🔄 更新版本

### 上传新版本

```bash
# 上传新版本文件
scp ~/.claude/dist/claude-workflow-toolkit-v1.0.1.tar.gz* \
    sudo_root@your-server:/home/sudo_root/workflow/

# 可选：更新安装脚本
scp ~/.claude/online-install.sh \
    sudo_root@your-server:/home/sudo_root/workflow/
```

### 保留多版本（推荐）

```bash
# 在服务器上创建版本目录
mkdir -p /home/sudo_root/workflow/v1.0.0
mkdir -p /home/sudo_root/workflow/v1.0.1

# 移动文件
mv /home/sudo_root/workflow/claude-workflow-toolkit-v1.0.0.tar.gz* \
   /home/sudo_root/workflow/v1.0.0/

# 更新 Nginx 配置支持多版本
```

---

## 🛠️ 故障排查

### 问题 1：404 Not Found

**原因**：路径配置错误或文件不存在

**解决**：
```bash
# 检查文件是否存在
ls -l /home/sudo_root/workflow/

# 检查 Nginx 配置
sudo nginx -t

# 查看错误日志
sudo tail /var/log/nginx/error.log
```

### 问题 2：403 Forbidden

**原因**：文件权限问题

**解决**：
```bash
# 设置正确的权限
chmod 644 /home/sudo_root/workflow/*.sh
chmod 644 /home/sudo_root/workflow/*.tar.gz*

# 检查目录权限
ls -ld /home/sudo_root/workflow/

# Nginx 用户需要有读取权限
sudo chown -R nginx:nginx /home/sudo_root/workflow/
# 或
sudo chown -R www-data:www-data /home/sudo_root/workflow/
```

### 问题 3：下载速度慢

**原因**：未启用 gzip 压缩

**解决**：
```nginx
# 在 Nginx 配置中添加 gzip
http {
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/javascript;
}
```

### 问题 4：内容类型错误

**原因**：Content-Type 设置不正确

**解决**：
```bash
# 确认 location 配置中包含：
default_type text/x-shellscript;
add_header Content-Type "text/x-shellscript; charset=utf-8";
```

---

## 📋 完整部署检查清单

部署前：
- [ ] 本地打包完成（package.sh）
- [ ] 文件已上传到服务器
- [ ] 修改 online-install.sh 中的 DOWNLOAD_BASE_URL

部署：
- [ ] 文件权限设置正确（644）
- [ ] Nginx 配置已添加
- [ ] Nginx 配置测试通过（nginx -t）
- [ ] Nginx 已重载（nginx -s reload）

验证：
- [ ] curl 测试安装脚本可访问
- [ ] curl 测试压缩包可下载
- [ ] 浏览器访问正常
- [ ] 完整安装流程测试通过

生产环境：
- [ ] HTTPS 已启用（Let's Encrypt）
- [ ] HTTP 自动重定向到 HTTPS
- [ ] 安全头已配置
- [ ] 日志正常记录

---

## 🎯 推荐配置

**生产环境**：
- ✅ 使用 HTTPS（Let's Encrypt）
- ✅ 启用访问日志
- ✅ 启用 gzip 压缩
- ✅ 设置合理的缓存策略
- ✅ 添加安全头

**开发/测试环境**：
- ✅ HTTP 即可
- ✅ 启用 autoindex（方便查看文件）
- ✅ 禁用缓存（方便更新）

---

## 📞 需要帮助？

如果遇到问题：

1. 检查 Nginx 错误日志：`/var/log/nginx/error.log`
2. 检查文件权限：`ls -l /home/sudo_root/workflow/`
3. 测试 Nginx 配置：`sudo nginx -t`
4. 查看完整部署指南：`~/.claude/docs/deployment-guide.md`

---

**完成后，用户可以通过以下命令一键安装**：

```bash
curl -fsSL https://your-domain.com/install.sh | bash
```

🎉 部署完成！
