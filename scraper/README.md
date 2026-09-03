# EWS 消费者评论每日抓取 + AI 中文总结

## 功能

每日自动从 Trustpilot 抓取 E-Wheels / MOMAS / LANDI 的消费者评论，通过 Kimi AI 生成中文总结，自动分级（🔴红/🔵蓝/🟢绿），输出 JSON 供 PWA 导入。

## 快速开始

### 1. 安装依赖

```bash
pip install requests beautifulsoup4
```

### 2. 配置 API Key

编辑 `config.json`，填入你的 **Kimi API Key**：

```json
{
  "kimi_api_key": "sk-你的APIKey",
  ...
}
```

> 获取 API Key: https://platform.moonshot.cn/

### 3. 本地测试运行

```bash
cd scraper
python ews_reviews_scraper.py
```

运行后生成 `reviews_output.json`，可直接导入 PWA。

### 4. 部署到 PythonAnywhere（推荐）

#### 4.1 上传文件
- 登录 https://www.pythonanywhere.com/
- Files → Upload → 上传 `ews_reviews_scraper.py` 和 `config.json`

#### 4.2 安装依赖
- 打开 Bash Console:
```bash
pip3 install --user requests beautifulsoup4
```

#### 4.3 设置定时任务
- Tasks → Schedule → 新建 Daily Task
- Command: `cd /home/你的用户名 && python3 ews_reviews_scraper.py`
- Time: 每天早上 8:00（UTC 转北京时间要减 8 小时，即 UTC 00:00 = 北京 08:00）

#### 4.4 设置文件公开访问
- 在 Web Apps 中，把 `reviews_output.json` 放到静态文件目录
- 或通过 Files → 右键 → "Get a sharing link for this file"

### 5. PWA 自动拉取（高级）

修改 PWA 的评论页面，添加自动拉取功能：

```javascript
async function autoFetchReviews() {
  const url = 'https://你的用户名.pythonanywhere.com/reviews_output.json';
  try {
    const res = await fetch(url + '?t=' + Date.now());
    const data = await res.json();
    DB.set('consumer_reviews', data.consumer_reviews);
    renderReviews();
    showToast('✅ 已同步最新评论');
  } catch(e) {
    showToast('❌ 同步失败');
  }
}
```

## 配置文件说明

| 字段 | 说明 |
|------|------|
| `kimi_api_key` | Kimi API Key（必填） |
| `kimi_model` | AI 模型，默认 moonshot-v1-8k |
| `pages_per_site` | 每个站点抓几页，默认 3 |
| `delay_between_requests` | 请求间隔秒数，防反爬 |
| `days_lookback` | 只抓最近几天的评论 |
| `sources` | 要抓取的商家列表 |

## 添加新的监控源

在 `config.json` 的 `sources` 中添加：

```json
{
  "name": "E-Wheels 瑞典",
  "url": "https://se.trustpilot.com/review/e-wheels.se",
  "brand": "E-Wheels",
  "market": "瑞典"
}
```

## 输出格式

```json
{
  "consumer_reviews": [
    {
      "id": "rev-2026-0828-01",
      "date": "2026-08-28",
      "market": "丹麦",
      "brand": "E-Wheels",
      "severity": "red",
      "originalText": "消费者原文...",
      "chineseSummary": "中文总结...",
      "impact": "影响分析...",
      "sourceName": "Trustpilot",
      "sourceUrl": "https://..."
    }
  ],
  "generated_at": "2026-09-03T08:00:00",
  "total_count": 15,
  "red_count": 3,
  "blue_count": 2,
  "green_count": 10
}
```

## 注意事项

1. **Trustpilot 反爬**：如果抓取失败，可能需要增加 `delay_between_requests` 或使用代理
2. **API 费用**：Kimi API 按 token 计费，每次总结约消耗 500-1000 tokens
3. **定时任务**：PythonAnywhere 免费版每天只能运行一次定时任务
4. **增量更新**：脚本会自动记录已处理的评论 ID，避免重复处理

## 故障排除

**抓取不到评论？**
- Trustpilot 页面结构会变化，需要更新 CSS 选择器
- 检查 `config.json` 中的 URL 是否正确

**AI 总结失败？**
- 检查 API Key 是否有效
- 检查网络连接

**输出文件为空？**
- 可能是所有评论都已处理过，删除 `.reviews_state.json` 重新运行
