import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";

const EBAY_API_BASE = "https://api.ebay.com";

async function ebayFetch(path, accessToken) {
  const res = await fetch(`${EBAY_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API ${res.status}: ${text}`);
  }
  return res.json();
}

async function getAccessToken() {
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN } = process.env;
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET || !EBAY_REFRESH_TOKEN) {
    throw new Error(
      "Missing eBay credentials. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_REFRESH_TOKEN in .env"
    );
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
      scope: "https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

const server = new McpServer({
  name: "ebay-mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "get_orders",
  {
    description: "Fetch recent eBay orders for the authenticated seller",
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(10).describe("Number of orders to return"),
      status: z
        .enum(["ACTIVE", "PENDING", "COMPLETED", "CANCELLED"])
        .optional()
        .describe("Filter by order status"),
    },
  },
  async ({ limit, status }) => {
    const token = await getAccessToken();
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("filter", `orderfulfillmentstatus:{${status}}`);
    const data = await ebayFetch(`/sell/fulfillment/v1/order?${params}`, token);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "get_inventory_items",
  {
    description: "List inventory items (active listings) for the authenticated seller",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("Number of items to return"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset"),
    },
  },
  async ({ limit, offset }) => {
    const token = await getAccessToken();
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const data = await ebayFetch(`/sell/inventory/v1/inventory_item?${params}`, token);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.registerTool(
  "get_seller_summary",
  {
    description: "Get the authenticated seller's account summary (username, feedback score, etc.)",
    inputSchema: {},
  },
  async () => {
    const token = await getAccessToken();
    const data = await ebayFetch("/commerce/identity/v1/user/", token);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
