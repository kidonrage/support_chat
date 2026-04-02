export const MCP_PROTOCOL_VERSION = "2025-03-26";

export function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

export function createJsonRpcSuccess(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function createJsonRpcError(id, code, message, data = null) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: data || undefined,
    },
  };
}
