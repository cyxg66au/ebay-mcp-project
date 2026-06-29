import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";

const EBAY_API_BASE = "https://api.ebay.com";

async function ebayFetch(path, accessToken, options = {}) {
  const res = await fetch(`${EBAY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getAccessToken() {
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN } = process.env;
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET || !EBAY_REFRESH_TOKEN) {
    throw new Error("Missing eBay credentials in environment variables.");
  }
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: EBAY_REFRESH_TOKEN,
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.marketing",
        "https://api.ebay.com/oauth/api_scope/buy.browse",
      ].join(" "),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "ebay-mcp-server", version: "0.2.0" });

// ─── 订单 ────────────────────────────────────────────────────────────────────

server.registerTool(
  "get_orders",
  {
    description: "获取卖家最近订单列表，可按状态筛选",
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(10).describe("返回订单数量"),
      status: z
        .enum(["ACTIVE", "PENDING", "COMPLETED", "CANCELLED"])
        .optional()
        .describe("订单状态筛选"),
    },
  },
  async ({ limit, status }) => {
    const token = await getAccessToken();
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("filter", `orderfulfillmentstatus:{${status}}`);
    const data = await ebayFetch(`/sell/fulfillment/v1/order?${params}`, token);
    return ok(data);
  }
);

server.registerTool(
  "get_order",
  {
    description: "获取单个订单的详细信息",
    inputSchema: {
      orderId: z.string().describe("订单 ID，例如 05-14840-20712"),
    },
  },
  async ({ orderId }) => {
    const token = await getAccessToken();
    const data = await ebayFetch(`/sell/fulfillment/v1/order/${orderId}`, token);
    return ok(data);
  }
);

// ─── 发货 ────────────────────────────────────────────────────────────────────

server.registerTool(
  "ship_order",
  {
    description: "为订单添加发货信息（快递单号、物流公司），标记为已发货",
    inputSchema: {
      orderId: z.string().describe("订单 ID"),
      trackingNumber: z.string().describe("快递单号"),
      shippingCarrierCode: z
        .string()
        .describe("物流公司代码，如 Australia_Post、StarTrack、Sendle、eBayPostageLabels"),
      shippingServiceCode: z
        .string()
        .optional()
        .describe("物流服务代码，如 AU_eBayPostageLabels（可选）"),
    },
  },
  async ({ orderId, trackingNumber, shippingCarrierCode, shippingServiceCode }) => {
    const token = await getAccessToken();
    const body = {
      lineItems: [{ lineItemId: "ALL" }],
      shippedDate: new Date().toISOString(),
      shippingCarrierCode,
      trackingNumber,
      ...(shippingServiceCode && { shippingServiceCode }),
    };
    const data = await ebayFetch(
      `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`,
      token,
      { method: "POST", body: JSON.stringify(body) }
    );
    return ok(data ?? { success: true, message: `订单 ${orderId} 已标记发货，快递单号：${trackingNumber}` });
  }
);

server.registerTool(
  "get_shipping_fulfillments",
  {
    description: "查看订单的发货记录",
    inputSchema: {
      orderId: z.string().describe("订单 ID"),
    },
  },
  async ({ orderId }) => {
    const token = await getAccessToken();
    const data = await ebayFetch(`/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, token);
    return ok(data);
  }
);

// ─── 消息 ────────────────────────────────────────────────────────────────────

server.registerTool(
  "get_messages",
  {
    description: "获取买家消息列表，可筛选未读消息",
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(10).describe("返回消息数量"),
      unread_only: z.boolean().default(false).describe("仅显示未读消息"),
    },
  },
  async ({ limit, unread_only }) => {
    const token = await getAccessToken();
    const params = new URLSearchParams({ limit: String(limit) });
    if (unread_only) params.set("filter", "readStatus:{UNREAD}");
    const data = await ebayFetch(`/sell/messaging/v1/message?${params}`, token);
    return ok(data);
  }
);

server.registerTool(
  "reply_to_message",
  {
    description: "回复买家消息",
    inputSchema: {
      messageId: z.string().describe("消息 ID"),
      body: z.string().describe("回复内容"),
    },
  },
  async ({ messageId, body }) => {
    const token = await getAccessToken();
    const data = await ebayFetch(`/sell/messaging/v1/message/${messageId}/reply`, token, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return ok(data ?? { success: true, message: "消息已发送" });
  }
);

server.registerTool(
  "send_message_to_buyer",
  {
    description: "主动发送消息给买家（需要提供订单 ID）",
    inputSchema: {
      itemId: z.string().describe("商品 ID（listing ID）"),
      recipientUsername: z.string().describe("买家 eBay 用户名"),
      subject: z.string().describe("消息主题"),
      body: z.string().describe("消息内容"),
    },
  },
  async ({ itemId, recipientUsername, subject, body }) => {
    const token = await getAccessToken();
    const payload = {
      itemId,
      recipientUsername,
      subject,
      body,
      messageType: "CONTACT_EBAY_MEMBER",
    };
    const data = await ebayFetch("/sell/messaging/v1/message", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return ok(data ?? { success: true, message: "消息已发送给买家" });
  }
);

// ─── 库存 ────────────────────────────────────────────────────────────────────

server.registerTool(
  "get_inventory_items",
  {
    description: "获取库存商品列表",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("返回数量"),
      offset: z.number().int().min(0).default(0).describe("分页偏移"),
    },
  },
  async ({ limit, offset }) => {
    const token = await getAccessToken();
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const data = await ebayFetch(`/sell/inventory/v1/inventory_item?${params}`, token);
    return ok(data);
  }
);

server.registerTool(
  "get_inventory_item",
  {
    description: "获取单个库存商品详情（含价格、数量、描述）",
    inputSchema: {
      sku: z.string().describe("商品 SKU"),
    },
  },
  async ({ sku }) => {
    const token = await getAccessToken();
    const data = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, token);
    return ok(data);
  }
);

server.registerTool(
  "update_inventory_quantity",
  {
    description: "更新商品库存数量",
    inputSchema: {
      sku: z.string().describe("商品 SKU"),
      quantity: z.number().int().min(0).describe("新的库存数量"),
    },
  },
  async ({ sku, quantity }) => {
    const token = await getAccessToken();
    // First get current item to preserve existing fields
    const current = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, token);
    current.availability = {
      ...current.availability,
      shipToLocationAvailability: { quantity },
    };
    await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, token, {
      method: "PUT",
      body: JSON.stringify(current),
    });
    return ok({ success: true, sku, newQuantity: quantity });
  }
);

server.registerTool(
  "get_offers",
  {
    description: "获取商品的 listing offer（含当前价格）",
    inputSchema: {
      sku: z.string().describe("商品 SKU"),
    },
  },
  async ({ sku }) => {
    const token = await getAccessToken();
    const data = await ebayFetch(
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
      token
    );
    return ok(data);
  }
);

server.registerTool(
  "update_price",
  {
    description: "更新商品售价",
    inputSchema: {
      offerId: z.string().describe("Offer ID（从 get_offers 获取）"),
      price: z.number().positive().describe("新价格（单位：AUD）"),
    },
  },
  async ({ offerId, price }) => {
    const token = await getAccessToken();
    const current = await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, token);
    current.pricingSummary = {
      ...current.pricingSummary,
      price: { value: String(price), currency: current.pricingSummary?.price?.currency ?? "AUD" },
    };
    const data = await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, token, {
      method: "PUT",
      body: JSON.stringify(current),
    });
    return ok(data ?? { success: true, offerId, newPrice: price });
  }
);

// ─── 卖家概览 ─────────────────────────────────────────────────────────────────

server.registerTool(
  "get_seller_summary",
  {
    description: "获取卖家账户摘要（反馈评分、账户信息等）",
    inputSchema: {},
  },
  async () => {
    const token = await getAccessToken();
    const data = await ebayFetch("/commerce/identity/v1/user/", token);
    return ok(data);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
