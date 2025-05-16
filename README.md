# Neovim MCP

A Model Context Protocol (MCP) server that communicates with a local Neovim session via its RPC protocol. This allows AI models like Claude to interact with your Neovim editor through the MCP framework.

## Features

This MCP server provides three main tools for AI model interaction with Neovim:

1. **View Buffers**: See the content of visible buffers with cursor position rendered
2. **Send Normal Mode Commands**: Execute normal mode keystrokes in Neovim
3. **Send Command Mode Commands**: Execute command mode commands and get their output

## Installation

```bash
npm install -g nvmmcp
```

Or use without installing:

```bash
npx nvmmcp /path/to/socket
```

## Usage

### 1. Start Neovim with a socket

Start Neovim with the `--listen` option to enable RPC communication:

```bash
nvim --listen /tmp/nvmmcp_bridge
```

### 2. Set up your MCP configuration

Add this server to your MCP configuration:

```json
{
  "mcpServers": {
    "neovim": {
      "command": "npx",
      "args": [
        "-y",
        "nvmmcp",
        "/tmp/nvmmcp_bridge"
      ]
    }
  }
}
```

### 3. Use the tools

The following tools are available to the AI:

- `view_buffers`: Shows the content of visible buffers with cursor position
- `send_normal_mode`: Sends keystrokes to Neovim in normal mode
- `send_command_mode`: Executes a command in Neovim's command mode and gets the output

## Development

To build from source:

```bash
git clone https://github.com/jakethekoenig/nvmmcp.git
cd nvmmcp
npm install
npm run build
```

### Running Locally

For local development without installing from npm, set up your MCP configuration to point directly to the built JavaScript file:

```json
{
  "mcpServers": {
    "nvim": {
      "command": "node",
      "args": [
        "/path/to/your/nvmmcp/dist/index.js",
        "/tmp/nvmmcp_bridge"
      ]
    }
  }
}
```

Replace `/path/to/your/nvmmcp` with the actual path to your local clone of this repository.

Then start Neovim with the socket:

```bash
nvim --listen /tmp/nvmmcp_bridge
```

## License

ISC
