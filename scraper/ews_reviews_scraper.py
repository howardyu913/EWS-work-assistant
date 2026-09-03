#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EWS 消费者评论每日抓取 + AI 中文总结
========================================
部署到 PythonAnywhere，设置每日定时任务自动执行。
输出 JSON 供 PWA 导入或自动拉取。

作者: Kimi Work Assistant
版本: 1.0.0
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ============ 配置 ============
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "reviews_output.json")
STATE_FILE = os.path.join(os.path.dirname(__file__), ".reviews_state.json")

DEFAULT_CONFIG = {
    "kimi_api_key": "",           # 你的 Kimi API Key
    "kimi_base_url": "https://api.moonshot.cn/v1",
    "kimi_model": "moonshot-v1-8k",
    "pages_per_site": 3,          # 每个站点抓前几页
    "reviews_per_page": 20,       # 每页评论数
    "delay_between_requests": 2,  # 请求间隔秒数（防反爬）
    "min_rating": 1,              # 最低评分（1-5，只抓<=此评分的）
    "days_lookback": 7,           # 抓取最近几天的评论
    "sources": [
        {
            "name": "E-Wheels 挪威",
            "url": "https://no.trustpilot.com/review/e-wheels.no",
            "brand": "E-Wheels",
            "market": "挪威"
        },
        {
            "name": "E-Wheels 丹麦",
            "url": "https://dk.trustpilot.com/review/e-wheels.dk",
            "brand": "E-Wheels",
            "market": "丹麦"
        },
        {
            "name": "LANDI 瑞士",
            "url": "https://ch.trustpilot.com/review/landi.ch",
            "brand": "LANDI",
            "market": "瑞士"
        }
    ]
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# ============ 工具函数 ============

def load_config():
    """加载配置文件，如果不存在则创建默认配置。"""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    # 创建默认配置文件
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
    print(f"✅ 已创建默认配置文件: {CONFIG_FILE}")
    print("⚠️  请先编辑 config.json，填入你的 Kimi API Key")
    sys.exit(1)


def load_state():
    """加载已处理的评论 ID 列表（去重用）。"""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"processed_ids": [], "last_run": None}


def save_state(state):
    """保存已处理的评论 ID 列表。"""
    state["last_run"] = datetime.now().isoformat()
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def parse_trustpilot_date(date_str):
    """解析 Trustpilot 日期字符串，如 'Aug 28, 2026' 或 '2026-08-28'."""
    formats = [
        "%b %d, %Y",
        "%B %d, %Y",
        "%Y-%m-%d",
        "%d %b %Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


# ============ 爬虫核心 ============

def fetch_reviews_trustpilot(source, config):
    """
    从 Trustpilot 抓取评论。
    返回列表: [{id, date, rating, title, content, author, verified, ...}]
    """
    reviews = []
    base_url = source["url"].rstrip("/")
    pages = config.get("pages_per_site", 3)
    delay = config.get("delay_between_requests", 2)
    
    print(f"\n🔍 开始抓取: {source['name']} ({base_url})")
    
    for page in range(1, pages + 1):
        url = f"{base_url}?page={page}"
        print(f"   正在获取第 {page} 页...")
        
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
        except Exception as e:
            print(f"   ⚠️  请求失败: {e}")
            continue
        
        soup = BeautifulSoup(resp.text, "html.parser")
        
        # Trustpilot 评论卡片的 CSS 选择器（会随网站更新而变化，需要维护）
        # 2024-2025 年的常见结构
        review_cards = soup.find_all("article", class_=re.compile("review"))
        
        if not review_cards:
            # 备选选择器
            review_cards = soup.select("[data-service-review-card]")
        
        if not review_cards:
            # 再备选：找包含 star rating 的 div
            review_cards = soup.find_all("div", attrs={"data-review-id": True})
        
        print(f"   找到 {len(review_cards)} 条评论")
        
        for card in review_cards:
            try:
                review = parse_review_card(card, source)
                if review:
                    reviews.append(review)
            except Exception as e:
                # 单条解析失败不影响整体
                continue
        
        time.sleep(delay)
    
    print(f"✅ 共抓取 {len(reviews)} 条评论")
    return reviews


def parse_review_card(card, source):
    """解析单条 Trustpilot 评论卡片。"""
    review = {
        "source_name": "Trustpilot",
        "source_url": source["url"],
        "brand": source.get("brand", ""),
        "market": source.get("market", ""),
    }
    
    # 评论 ID
    review_id = card.get("data-review-id", "")
    if not review_id:
        review_id_elem = card.find("a", href=re.compile("/reviews/"))
        if review_id_elem:
            match = re.search(r"/reviews/([a-f0-9]+)", review_id_elem.get("href", ""))
            if match:
                review_id = match.group(1)
    review["id"] = review_id or f"unknown-{hash(str(card)) & 0xFFFFFFFF}"
    
    # 评分
    rating = None
    # 方法1: 从 img alt 提取
    star_img = card.find("img", alt=re.compile(r"\d+ stars?"))
    if star_img:
        match = re.search(r"(\d+)", star_img.get("alt", ""))
        if match:
            rating = int(match.group(1))
    # 方法2: 从 data-rating 提取
    if rating is None:
        rating_elem = card.find(attrs={"data-rating": True})
        if rating_elem:
            rating = int(rating_elem["data-rating"])
    review["rating"] = rating or 0
    
    # 标题
    title_elem = card.find("h2") or card.find("a", {"data-review-title-link": True})
    review["title"] = title_elem.get_text(strip=True) if title_elem else ""
    
    # 内容
    content_elem = (
        card.find("p", {"data-service-review-text-typography": True})
        or card.find("p", class_=re.compile("review-content"))
        or card.find("div", class_=re.compile("review-content"))
    )
    review["content"] = content_elem.get_text(strip=True) if content_elem else ""
    
    # 日期
    date_elem = (
        card.find("time")
        or card.find("span", text=re.compile(r"\d+\s+(minutes?|hours?|days?|weeks?|months?|years?)\s+ago"))
        or card.find("div", class_=re.compile("date"))
    )
    date_str = ""
    if date_elem:
        if date_elem.name == "time":
            date_str = date_elem.get("datetime", date_elem.get_text(strip=True))
        else:
            date_str = date_elem.get_text(strip=True)
    
    # 处理相对时间
    review["date_raw"] = date_str
    review["date"] = normalize_date(date_str)
    
    # 作者
    author_elem = card.find("span", class_=re.compile("consumer-name")) or card.find("div", class_=re.compile("consumer"))
    review["author"] = author_elem.get_text(strip=True) if author_elem else ""
    
    # 是否已验证
    review["verified"] = bool(card.find("span", text=re.compile(r"Verified")) or card.find("svg", title=re.compile(r"Verified")))
    
    # 回复
    reply_elem = card.find("div", class_=re.compile("reply")) or card.find("p", {"data-service-review-business-user-text": True})
    review["reply"] = reply_elem.get_text(strip=True) if reply_elem else ""
    
    return review


def normalize_date(date_str):
    """将各种日期格式统一为 YYYY-MM-DD。"""
    if not date_str:
        return ""
    
    # 处理 ISO 格式
    iso_match = re.match(r"(\d{4}-\d{2}-\d{2})", date_str)
    if iso_match:
        return iso_match.group(1)
    
    # 处理相对时间
    now = datetime.now()
    rel_match = re.match(r"(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago", date_str.lower())
    if rel_match:
        num = int(rel_match.group(1))
        unit = rel_match.group(2)
        delta = {
            "minute": timedelta(minutes=num),
            "hour": timedelta(hours=num),
            "day": timedelta(days=num),
            "week": timedelta(weeks=num),
            "month": timedelta(days=num * 30),
            "year": timedelta(days=num * 365),
        }.get(unit, timedelta(days=num))
        return (now - delta).strftime("%Y-%m-%d")
    
    # 尝试各种格式
    dt = parse_trustpilot_date(date_str)
    if dt:
        return dt.strftime("%Y-%m-%d")
    
    return ""


# ============ AI 总结 ============

def summarize_with_kimi(reviews, config):
    """
    使用 Kimi API 对评论进行中文总结和分级。
    为了节省 token，批量处理（每批 5 条）。
    """
    api_key = config.get("kimi_api_key", "")
    if not api_key:
        print("⚠️  未配置 Kimi API Key，跳过 AI 总结")
        return []
    
    base_url = config.get("kimi_base_url", "https://api.moonshot.cn/v1")
    model = config.get("kimi_model", "moonshot-v1-8k")
    
    summarized = []
    batch_size = 5
    
    print(f"\n🤖 开始 AI 总结（共 {len(reviews)} 条，分 { (len(reviews) + batch_size - 1) // batch_size } 批）...")
    
    for i in range(0, len(reviews), batch_size):
        batch = reviews[i:i + batch_size]
        print(f"   处理第 {i+1}-{min(i+batch_size, len(reviews))} 条...")
        
        # 构建 prompt
        prompt = build_summary_prompt(batch)
        
        try:
            result = call_kimi_api(prompt, api_key, base_url, model)
            parsed = parse_kimi_response(result, batch)
            summarized.extend(parsed)
        except Exception as e:
            print(f"   ⚠️  AI 总结失败: {e}")
            # 失败时保留原始数据
            for r in batch:
                summarized.append({
                    **r,
                    "chineseSummary": r.get("content", "")[:100] + "..." if len(r.get("content", "")) > 100 else r.get("content", ""),
                    "impact": "（AI总结失败，请手动处理）",
                    "severity": "green",
                })
        
        time.sleep(1)  # API 限流保护
    
    print(f"✅ AI 总结完成")
    return summarized


def build_summary_prompt(reviews):
    """构建给 Kimi 的 prompt。"""
    reviews_text = ""
    for idx, r in enumerate(reviews, 1):
        reviews_text += f"\n--- 评论 {idx} ---\n"
        reviews_text += f"日期: {r.get('date', '未知')}\n"
        reviews_text += f"评分: {r.get('rating', '未知')}/5\n"
        reviews_text += f"标题: {r.get('title', '')}\n"
        reviews_text += f"内容: {r.get('content', '')}\n"
        if r.get("reply"):
            reviews_text += f"商家回复: {r['reply']}\n"
    
    prompt = f"""你是 EWS（电动出行品牌）的市场情报分析师。请对以下 Trustpilot 消费者评论进行专业分析。

{reviews_text}

请对每条评论输出以下 JSON 格式（严格按此格式，不要额外文字）：

{{
  "results": [
    {{
      "chineseSummary": "用1-2句话中文概括核心问题",
      "impact": "分析这条评论对品牌的潜在影响，包括产品安全、售后、口碑等方面",
      "severity": "red|blue|green",
      "severityReason": "为什么分到这个级别"
    }},
    ...
  ]
}}

分级标准：
- 🔴 red: 涉及人身安全事故、严重产品缺陷、多次维修失败、电气/刹车安全问题
- 🔵 blue: 产品迭代/换代信号、市场策略变化、重要商业动态、库存变化
- 🟢 green: 一般服务体验、轻微产品问题、正面评价、保修流程反馈

注意：
1. 必须是合法 JSON，不要 markdown 代码块包裹
2. 每条评论必须对应一个结果
3. chineseSummary 要精炼，50字以内
"""
    return prompt


def call_kimi_api(prompt, api_key, base_url, model):
    """调用 Kimi API。"""
    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是一个专业的市场情报分析师，擅长从消费者评论中提取关键信息并生成简洁的中文总结。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 2000,
    }
    
    resp = requests.post(url, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_kimi_response(text, original_reviews):
    """解析 Kimi 返回的 JSON，合并到原始评论中。"""
    # 清理可能的 markdown 代码块
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    
    try:
        data = json.loads(text)
        results = data.get("results", [])
    except json.JSONDecodeError:
        # 尝试用正则提取 JSON
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            data = json.loads(match.group(0))
            results = data.get("results", [])
        else:
            raise
    
    merged = []
    for i, r in enumerate(original_reviews):
        summary = ""
        impact = ""
        severity = "green"
        if i < len(results):
            summary = results[i].get("chineseSummary", "")
            impact = results[i].get("impact", "")
            severity = results[i].get("severity", "green")
        
        merged.append({
            **r,
            "chineseSummary": summary or r.get("content", "")[:80] + "...",
            "impact": impact or "（未生成影响分析）",
            "severity": severity if severity in ("red", "blue", "green") else "green",
            "id": r.get("id", f"rev-{i}"),
        })
    
    return merged


# ============ 过滤与去重 ============

def filter_new_reviews(reviews, state, config):
    """过滤掉已处理的评论，只保留新的。"""
    processed = set(state.get("processed_ids", []))
    days_lookback = config.get("days_lookback", 7)
    cutoff = datetime.now() - timedelta(days=days_lookback)
    
    new_reviews = []
    for r in reviews:
        rid = r.get("id", "")
        # 去重
        if rid in processed:
            continue
        # 时间过滤
        date_str = r.get("date", "")
        if date_str:
            try:
                review_date = datetime.strptime(date_str, "%Y-%m-%d")
                if review_date < cutoff:
                    continue
            except ValueError:
                pass
        new_reviews.append(r)
        processed.add(rid)
    
    state["processed_ids"] = list(processed)
    return new_reviews


# ============ 输出 ============

def save_output(reviews, existing=None):
    """保存为 PWA 可导入的 JSON 格式。"""
    if existing is None:
        existing = []
    
    # 合并新旧数据
    all_reviews = existing + reviews
    
    # 按日期倒序
    all_reviews.sort(key=lambda x: x.get("date", ""), reverse=True)
    
    # 去重（按 ID）
    seen = set()
    unique = []
    for r in all_reviews:
        rid = r.get("id", "")
        if rid and rid in seen:
            continue
        seen.add(rid)
        unique.append(r)
    
    output = {
        "consumer_reviews": unique,
        "generated_at": datetime.now().isoformat(),
        "total_count": len(unique),
        "red_count": len([r for r in unique if r.get("severity") == "red"]),
        "blue_count": len([r for r in unique if r.get("severity") == "blue"]),
        "green_count": len([r for r in unique if r.get("severity") == "green"]),
    }
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    return output


def load_existing_output():
    """加载已有的输出文件（增量更新）。"""
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("consumer_reviews", [])
    return []


# ============ 主流程 ============

def main():
    print("=" * 60)
    print("EWS 消费者评论每日抓取 + AI 总结")
    print(f"启动时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # 1. 加载配置
    config = load_config()
    
    # 2. 加载状态（已处理评论ID）
    state = load_state()
    
    # 3. 抓取评论
    all_reviews = []
    for source in config.get("sources", []):
        reviews = fetch_reviews_trustpilot(source, config)
        all_reviews.extend(reviews)
        time.sleep(config.get("delay_between_requests", 2))
    
    print(f"\n📊 本次共抓取 {len(all_reviews)} 条原始评论")
    
    # 4. 过滤新评论
    new_reviews = filter_new_reviews(all_reviews, state, config)
    print(f"📊 其中新评论: {len(new_reviews)} 条")
    
    if not new_reviews:
        print("✅ 没有新评论，无需处理")
        save_state(state)
        return
    
    # 5. AI 总结
    summarized = summarize_with_kimi(new_reviews, config)
    
    # 6. 合并已有数据
    existing = load_existing_output()
    output = save_output(summarized, existing)
    
    # 7. 保存状态
    save_state(state)
    
    # 8. 输出报告
    print("\n" + "=" * 60)
    print("✅ 处理完成!")
    print(f"📁 输出文件: {OUTPUT_FILE}")
    print(f"📊 总评论数: {output['total_count']}")
    print(f"   🔴 红色: {output['red_count']}")
    print(f"   🔵 蓝色: {output['blue_count']}")
    print(f"   🟢 绿色: {output['green_count']}")
    print("=" * 60)
    
    # 9. 打印摘要（用于邮件/通知）
    print("\n📋 今日新增摘要:")
    for r in summarized[:5]:
        sev_emoji = {"red": "🔴", "blue": "🔵", "green": "🟢"}.get(r.get("severity", "green"), "🟢")
        print(f"   {sev_emoji} [{r.get('date', '')}] {r.get('brand', '')} {r.get('market', '')}")
        print(f"      总结: {r.get('chineseSummary', '')}")
    
    if len(summarized) > 5:
        print(f"   ... 还有 {len(summarized) - 5} 条")


if __name__ == "__main__":
    main()
