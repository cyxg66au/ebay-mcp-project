import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ─── eBay Auth ────────────────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN } = process.env;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: EBAY_REFRESH_TOKEN,
      scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function ebay(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://api.ebay.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
      ...options.headers,
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// ─── OAuth Routes ─────────────────────────────────────────────────────────────

const RUNAME = "Gang_Chen-GangChen-MCPtes-qghrudfc";
const FULL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.messaging",
].join(" ");

app.get("/api/auth/messaging", (req, res) => {
  const url = `https://auth.ebay.com/oauth2/authorize?` + new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID,
    redirect_uri: RUNAME,
    response_type: "code",
    scope: FULL_SCOPES,
    prompt: "login",
  });
  res.redirect(url);
});

app.post("/api/auth/exchange", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "missing code" });
  try {
    const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET } = process.env;
    const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
    const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: RUNAME }),
    });
    const data = await r.json();
    if (!data.refresh_token) return res.status(400).json({ error: data.error_description || JSON.stringify(data) });
    process.env.EBAY_REFRESH_TOKEN = data.refresh_token;
    cachedToken = null;
    // Persist to .env
    const { readFileSync, writeFileSync } = await import("fs");
    const envPath = new URL(".env", import.meta.url).pathname;
    let envContent = readFileSync(envPath, "utf8");
    envContent = envContent.replace(/^EBAY_REFRESH_TOKEN=.*$/m, `EBAY_REFRESH_TOKEN="${data.refresh_token}"`);
    writeFileSync(envPath, envContent);
    res.json({ success: true, refresh_token: data.refresh_token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ 授权失败，未收到 code");
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET } = process.env;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: RUNAME }),
  });
  const data = await r.json();
  if (data.refresh_token) {
    process.env.EBAY_REFRESH_TOKEN = data.refresh_token;
    cachedToken = null; // 清除缓存，强制用新 token
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>✅ 授权成功！</h2>
      <p>新 Refresh Token 已更新，消息功能已开启。</p>
      <p style="font-size:12px;color:#888;margin-top:16px;">新 Token（请更新 .env 文件）：<br>
      <code style="background:#f0f0f0;padding:4px 8px;border-radius:4px;word-break:break-all">${data.refresh_token}</code></p>
      <a href="/" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#e53238;color:#fff;border-radius:6px;text-decoration:none">返回后台</a>
    </body></html>`);
  } else {
    res.send(`❌ 获取 Token 失败：${JSON.stringify(data)}`);
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// 今日待发货订单
app.get("/api/orders/pending", async (req, res) => {
  try {
    const data = await ebay("/sell/fulfillment/v1/order?limit=50");
    const pending = (data.orders || []).filter(o => o.orderFulfillmentStatus === "NOT_STARTED");
    res.json({ orders: pending, total: pending.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 所有订单
app.get("/api/orders", async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const data = await ebay(`/sell/fulfillment/v1/order?limit=${limit}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 今日营业额统计
app.get("/api/stats/today", async (req, res) => {
  try {
    // 拉最近100单，足以覆盖今日所有订单
    const data = await ebay("/sell/fulfillment/v1/order?limit=100");
    const orders = data.orders || [];
    const today = new Date().toISOString().split("T")[0];

    const todayOrders = orders.filter(o => o.creationDate?.startsWith(today));
    const revenue = todayOrders.reduce((sum, o) => {
      return sum + parseFloat(o.pricingSummary?.total?.value || 0);
    }, 0);
    const netRevenue = todayOrders.reduce((sum, o) => {
      return sum + parseFloat(o.paymentSummary?.totalDueSeller?.value || 0);
    }, 0);
    const fees = todayOrders.reduce((sum, o) => {
      return sum + parseFloat(o.totalMarketplaceFee?.value || 0);
    }, 0);
    const pending = todayOrders.filter(o => o.orderFulfillmentStatus === "NOT_STARTED").length;
    const shipped = todayOrders.filter(o => o.orderFulfillmentStatus !== "NOT_STARTED").length;

    // 按商品汇总
    const itemMap = {};
    todayOrders.forEach(o => {
      o.lineItems?.forEach(item => {
        const key = item.sku || item.title;
        if (!itemMap[key]) itemMap[key] = { title: item.title, sku: item.sku, qty: 0, revenue: 0 };
        itemMap[key].qty += item.quantity || 1;
        itemMap[key].revenue += parseFloat(item.total?.value || 0);
      });
    });
    const topItems = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    res.json({
      date: today,
      orderCount: todayOrders.length,
      revenue: revenue.toFixed(2),
      netRevenue: netRevenue.toFixed(2),
      fees: fees.toFixed(2),
      pendingShipment: pending,
      shipped,
      currency: "AUD",
      topItems,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 标记发货
app.post("/api/orders/:orderId/ship", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { trackingNumber, carrier } = req.body;
    const body = {
      lineItems: [{ lineItemId: "ALL" }],
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrier,
      trackingNumber,
    };
    await ebay(`/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 消息列表（对话）
app.get("/api/messages", async (req, res) => {
  try {
    const unread = req.query.unread === "true";
    const filter = unread ? "&filter=readStatus:%7BUNREAD%7D" : "";
    const data = await ebay(`/sell/messaging/v1/conversation?limit=20${filter}`);
    res.json(data || { conversations: [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 回复消息
app.post("/api/messages/:conversationId/reply", async (req, res) => {
  try {
    const data = await ebay(`/sell/messaging/v1/conversation/${req.params.conversationId}/message`, {
      method: "POST",
      body: JSON.stringify({ body: req.body.body }),
    });
    res.json(data || { success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 近期热销商品（从订单中汇总）
app.get("/api/inventory", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 0;
    const cutoff = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;
    const data = await ebay("/sell/fulfillment/v1/order?limit=100");
    const orders = (data.orders || []).filter(o => !cutoff || o.creationDate >= cutoff);
    const itemMap = {};
    orders.forEach(o => {
      o.lineItems?.forEach(item => {
        const key = item.sku || item.legacyItemId;
        if (!itemMap[key]) {
          itemMap[key] = {
            sku: item.sku || item.legacyItemId,
            product: { title: item.title },
            totalSold: 0,
            totalRevenue: 0,
            legacyItemId: item.legacyItemId,
            lastSold: o.creationDate?.split("T")[0],
          };
        }
        itemMap[key].totalSold += item.quantity || 1;
        itemMap[key].totalRevenue += parseFloat(item.total?.value || 0);
        if (o.creationDate > (itemMap[key].lastSold || "")) {
          itemMap[key].lastSold = o.creationDate?.split("T")[0];
        }
      });
    });
    const inventoryItems = Object.values(itemMap)
      .sort((a, b) => b.totalSold - a.totalSold);
    const label = days === 7 ? "近一周" : days === 30 ? "近一个月" : days === 90 ? "近三个月" : "近100笔订单";
    const totalRevenue = inventoryItems.reduce((s, i) => s + i.totalRevenue, 0).toFixed(2);
    res.json({ inventoryItems, total: inventoryItems.length, totalRevenue, note: `基于${label}销售数据统计（共${orders.length}笔订单，共计：AUD ${totalRevenue}）` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新库存数量
app.put("/api/inventory/:sku/quantity", async (req, res) => {
  try {
    const sku = decodeURIComponent(req.params.sku);
    const current = await ebay(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
    current.availability = { ...current.availability, shipToLocationAvailability: { quantity: req.body.quantity } };
    await ebay(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: JSON.stringify(current),
    });
    res.json({ success: true, sku, quantity: req.body.quantity });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ eBay Dashboard running at http://localhost:${PORT}`));
