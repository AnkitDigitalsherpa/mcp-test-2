"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
// Helper to construct the MCP server with tools/resources
function makeMcpServer() {
    const server = new mcp_js_1.McpServer({
        name: "My TS MCP Server",
        version: "1.0.0",
    });
    // Add a simple tool “add”
    server.registerTool("add", {
        title: "Add two numbers",
        description: "Return the sum of a and b",
        inputSchema: {
            a: zod_1.z.number(),
            b: zod_1.z.number(),
        },
    }, async ({ a, b }) => {
        return {
            content: [{ type: "text", text: String(a + b) }],
        };
    });
    // Add a greeting resource
    server.registerResource("greet", new mcp_js_1.ResourceTemplate("greet://{name}", { list: undefined }), {
        title: "Greeting Resource",
        description: "Returns a greeting",
    }, async (uri, { name }) => {
        return {
            contents: [
                {
                    uri: uri.href,
                    text: `Hello, ${name}!`,
                },
            ],
        };
    });
    return server;
}
async function main() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Map sessionId → transport
    // const transports: Record<string, StreamableHTTPServerTransport> = {};
    const transports = {};
    const mcpServer = makeMcpServer();
    app.post("/mcp", async (req, res) => {
        try {
            const sessionIdHeader = req.header("Mcp-Session-Id");
            let transport;
            if (sessionIdHeader && transports[sessionIdHeader]) {
                transport = transports[sessionIdHeader];
            }
            else if (!sessionIdHeader && (0, types_js_1.isInitializeRequest)(req.body)) {
                // New initialization
                transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                    // you can optionally pass a custom sessionId generator
                    sessionIdGenerator: () => (0, crypto_1.randomUUID)(),
                    // (optionally enable DNS rebinding protection, allowedOrigins, etc.)
                });
                // Register this transport
                transports[transport.sessionId] = transport;
                // Connect the server to this transport
                await mcpServer.connect(transport);
            }
            if (!transport) {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "No valid session or initialize request",
                    },
                    id: null,
                });
                return;
            }
            // Delegate to transport’s handler
            await transport.handleRequest(req, res, req.body);
        }
        catch (err) {
            console.error("Error in /mcp POST:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal error",
                    },
                    id: null,
                });
            }
        }
    });
    // Optionally support GET /mcp for server‑initiated requests (SSE)
    app.get("/mcp", (req, res) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: {
                code: -32000,
                message: "GET not supported in this example",
            },
            id: null,
        });
    });
    // DELETE /mcp to terminate session
    app.delete("/mcp", (req, res) => {
        const sessionId = req.header("Mcp-Session-Id");
        if (sessionId && transports[sessionId]) {
            transports[sessionId].close();
            delete transports[sessionId];
            res.status(200).json({ message: "Session terminated" });
        }
        else {
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Invalid session",
                },
                id: null,
            });
        }
    });
    const port = 3000;
    app.listen(port, () => {
        console.log(`MCP server listening at http://localhost:${port}/mcp`);
    });
}
main().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});
