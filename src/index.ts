import express, { Request, Response } from "express";
import { randomUUID } from "crypto";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { z } from "zod";

// Helper to construct the MCP server with tools/resources
function makeMcpServer(): McpServer {
  const server = new McpServer({
    name: "My TS MCP Server",
    version: "1.0.0",
  });

  // Add a simple tool “add”
  server.registerTool(
    "add",
    {
      title: "Add two numbers",
      description: "Return the sum of a and b",
      inputSchema: {
        a: z.number(),
        b: z.number(),
      },
    },
    async ({ a, b }) => {
      return {
        content: [{ type: "text", text: String(a + b) }],
      };
    }
  );

  // Add a greeting resource
  server.registerResource(
    "greet",
    new ResourceTemplate("greet://{name}", { list: undefined }),
    {
      title: "Greeting Resource",
      description: "Returns a greeting",
    },
    async (uri, { name }) => {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Hello, ${name}!`,
          },
        ],
      };
    }
  );

  return server;
}

async function main() {
  const app = express();
  app.use(express.json());

  // Map sessionId → transport
  // const transports: Record<string, StreamableHTTPServerTransport> = {};
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const mcpServer = makeMcpServer();

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = req.header("Mcp-Session-Id");
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionIdHeader && transports[sessionIdHeader]) {
        transport = transports[sessionIdHeader];
      } else if (!sessionIdHeader && isInitializeRequest(req.body)) {
        // New initialization
        transport = new StreamableHTTPServerTransport({
          // you can optionally pass a custom sessionId generator
          sessionIdGenerator: () => randomUUID(),
          // (optionally enable DNS rebinding protection, allowedOrigins, etc.)
        });
        // Register this transport
        transports[transport.sessionId!] = transport;

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
    } catch (err) {
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
  app.get("/mcp", (req: Request, res: Response) => {
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
  app.delete("/mcp", (req: Request, res: Response) => {
    const sessionId = req.header("Mcp-Session-Id");
    if (sessionId && transports[sessionId]) {
      transports[sessionId].close();
      delete transports[sessionId];
      res.status(200).json({ message: "Session terminated" });
    } else {
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
