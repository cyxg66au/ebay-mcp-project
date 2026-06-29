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

## Usage

Connect this server to any MCP-compatible client (e.g., Claude Desktop) by adding it to your MCP config:

```json
{
  "mcpServers": {
    "ebay": {
      "command": "node",
      "args": ["path/to/ebay-mcp-project/index.js"]
    }
  }
}
```

## License

MIT
