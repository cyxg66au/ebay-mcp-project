# eBay MCP Server

A Model Context Protocol (MCP) server that exposes eBay seller APIs as tools for AI assistants.

## Features

- Browse active listings
- Manage inventory items
- View orders and fulfillment status
- Handle customer messages

## Getting Started

### Prerequisites

- Node.js 18+
- An eBay developer account with API credentials

### Installation

```bash
npm install
```

### Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `EBAY_CLIENT_ID` | Your eBay application client ID |
| `EBAY_CLIENT_SECRET` | Your eBay application client secret |
| `EBAY_REFRESH_TOKEN` | OAuth refresh token for your seller account |

### Running

```bash
npm start
```

## Available Tools

| Tool | Description |
|---|---|
| `get_orders` | Fetch recent orders (filterable by status) |
| `get_inventory_items` | List active inventory/listings with pagination |
| `get_seller_summary` | Get seller account info and feedback score |

## Usage with Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ebay": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/Documents/ebay-mcp-project/index.js"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

Then restart Claude Desktop — you'll see the eBay tools available in the tools panel.

## License

MIT
