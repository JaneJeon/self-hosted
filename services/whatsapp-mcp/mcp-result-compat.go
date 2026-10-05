package mcp

import (
	"encoding/json"

	"github.com/mark3labs/mcp-go/mcp"
)

// Match the local desktop adapter: keep the typed result and also include its
// JSON in text content, so clients that consume only content can read the rows.
func newStructuredResult(data any, fallback string) *mcp.CallToolResult {
	result := mcp.NewToolResultStructured(data, fallback)
	if result.StructuredContent != nil {
		if encoded, err := json.Marshal(result.StructuredContent); err == nil {
			result.Content = append(result.Content, mcp.NewTextContent(string(encoded)))
		}
	}
	return result
}
