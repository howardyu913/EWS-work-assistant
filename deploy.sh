#!/bin/bash
# 工作助手 - GitHub Pages 部署脚本
# 用法: ./deploy.sh

set -e

echo "🚀 工作助手 - GitHub Pages 部署脚本"
echo ""

# 获取 GitHub 用户名
read -p "请输入你的 GitHub 用户名: " GITHUB_USER
if [ -z "$GITHUB_USER" ]; then
    echo "❌ 用户名不能为空"
    exit 1
fi

REPO_NAME="work-assistant"
REMOTE_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

echo ""
echo "📋 部署步骤:"
echo "1. 访问 https://github.com/new"
echo "2. 仓库名称填写: ${REPO_NAME}"
echo "3. 选择 Public (Pages 需要)"
echo "4. 点击 Create repository"
echo ""
read -p "创建好仓库后按回车继续..."

echo ""
echo "🔗 添加远程仓库..."
git remote add origin "$REMOTE_URL" 2>/dev/null || git remote set-url origin "$REMOTE_URL"

echo "📤 推送代码到 GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ 代码推送成功!"
echo ""
echo "⚙️  接下来请在浏览器中完成以下步骤:"
echo ""
echo "   1. 打开 https://github.com/${GITHUB_USER}/${REPO_NAME}/settings/pages"
echo "   2. Branch 选择 'main'，文件夹选择 '/ (root)'"
echo "   3. 点击 Save"
echo ""
echo "   ⏳ 等待 1-2 分钟后，访问:"
echo "   🌐 https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo ""
echo "📱 用 Safari 打开上面的链接，点击分享 → 添加到主屏幕即可!"
