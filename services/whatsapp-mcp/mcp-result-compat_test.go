package mcp

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
)

func TestMessageRowsReachTextOnlyClients(t *testing.T) {
	rows := map[string]any{"data": []map[string]string{{
		"id": "fixture-message", "body": "Fixture message café",
	}}}
	result := newStructuredResult(rows, "Retrieved 1 messages")
	if result.StructuredContent == nil || len(result.Content) != 2 {
		t.Fatal("must preserve structured data and the original fallback")
	}
	text, ok := result.Content[1].(mcp.TextContent)
	if !ok || !strings.Contains(text.Text, "Fixture message café") {
		t.Fatal("a text-only client must receive the actual message rows")
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(text.Text), &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded["data"].([]any)) != 1 {
		t.Fatal("text representation lost message rows")
	}
}
