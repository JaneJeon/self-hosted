package mcp

import (
	"encoding/json"

	"github.com/mark3labs/mcp-go/mcp"
)

const contactsDescription = "Retrieve contacts. Read data[].name and data[].jid to resolve a person's name to a full chat JID. Contacts can include both phone-number @s.whatsapp.net and @lid entries for one person. For stored message history, try the matching phone-number JID if the LID has no rows. Results include JSON text for text-only clients."
const chatsDescription = "Retrieve recent chats with pagination and search filters. Cached chat names can be a device label rather than the person's name. For a person-name request, resolve whatsapp_list_contacts first and use the returned full JID with whatsapp_get_chat_messages. A name search here searches cached chat rows, not the contact directory."
const messagesDescription = "Fetch stored messages by full chat_jid, with pagination, search and RFC3339 time filters. Resolve person names with whatsapp_list_contacts. If a matched @lid yields no history, try that contact's phone-number @s.whatsapp.net JID before concluding no messages exist. Read data[].content and data[].timestamp; the count text alone is not the result. Reading does not mark messages as read."

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
