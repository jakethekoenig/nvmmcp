# Neovim MCP

A Model Context Protocol (MCP) server that communicates with a local Neovim session via its RPC protocol. This allows AI models like Claude to interact with your Neovim editor through the MCP framework.

## Features

This MCP server provides tools and resources for AI model interaction with Neovim:

### Tools

1. **Send Normal Mode Commands**: Execute normal mode keystrokes in Neovim
2. **Send Command Mode Commands**: Execute command mode commands and get their output

### Resources

1. **Buffers Resource**: Access the content of visible buffers with cursor position rendered

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

### 3. Use the tools and resources

The following tools are available to the AI:

- `send_normal_mode`: Sends keystrokes to Neovim in normal mode
- `send_command_mode`: Executes a command in Neovim's command mode and gets the output

The following resources are available to the AI:

- `neovim-buffer://current`: Accesses the content of visible Neovim buffers with cursor positions

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

### Testing

The project includes an integration test that verifies communication between the nvmmcp server and Neovim.

#### Running the integration test

Make sure you have Neovim installed and available in your PATH, then run:

```bash
# Make the script executable if needed
chmod +x run-integration-tests.sh

# Run the integration tests
./run-integration-tests.sh
```

This test will:
1. Start a Neovim instance with a socket bridge
2. Connect the nvmmcp server to that socket
3. Test sending normal mode commands to write text
4. Test sending command mode commands to save to a file
5. Verify the file was created with the correct content

You can also run the test directly with Jest:

```bash
npm run test:integration
```

#### What's being tested

The integration test validates that:
- The server can connect to a Neovim instance
- Normal mode commands can be sent and executed
- Command mode commands can be sent and executed
- File operations work correctly

## Resource Usage Examples

### Buffers Resource

The `buffers` resource allows AI models to access the current editor state with cursor positions and visible content:

```json
{
  "method": "resources/read",
  "params": {
    "uri": "neovim-buffer://current"
  }
}
```

This returns a structured JSON resource containing:
- All visible windows and buffers
- Cursor positions (marked with 🔸 in content)
- Active buffer indication
- Line numbers in content
- Visible range information

The resource will also send notifications via `resources/changed` whenever buffer contents change, cursor moves, or buffer state changes, allowing clients to keep their view of the editor up to date.

## License

MIT
