# Neovim MCP

A Model Context Protocol (MCP) server that communicates with a local Neovim session via its RPC protocol. This allows AI models like Claude to interact with your Neovim editor through the MCP framework.

## Features

This MCP server provides tools and resources for AI model interaction with Neovim:

### Tools

1. **Send Normal Mode Commands**: Execute normal mode keystrokes in Neovim
2. **Send Command Mode Commands**: Execute command mode commands and get their output

### Resources

1. **Buffers**: Access the content of all visible Neovim buffers with cursor positions rendered

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
- `send_command_mode`: Executes a command in Neovim's command mode and get the output

The following resources are available to the AI:

- `buffers`: Accesses the content of all visible Neovim buffers with cursor positions

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

The `buffers` resource allows AI models to access the current editor state (visible buffers, cursor positions, content) through the MCP resources protocol.

```json
{
  "method": "resources/create",
  "params": {
    "type": "buffers"
  }
}
```

This returns a resource with the following structure:

```json
{
  "resource": {
    "windows": [
      {
        "windowNumber": 1,
        "isCurrentWindow": true,
        "bufferNumber": 1,
        "bufferName": "/path/to/file.js",
        "cursor": [3, 10],
        "content": "Line 1\nLine 2\nLine |3\nLine 4\nLine 5"
      },
      {
        "windowNumber": 2,
        "isCurrentWindow": false,
        "bufferNumber": 2,
        "bufferName": "/path/to/another/file.md",
        "cursor": [1, 0],
        "content": "# Header\nContent\nMore content"
      }
    ],
    "timestamp": "2025-05-18T12:34:56.789Z"
  }
}
```

The cursor position is marked with a pipe character (`|`) in the content for the current window.

## License

ISC
