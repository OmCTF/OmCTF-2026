package guild

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	c "svyaz.local/foundation/packages/contracts/generated/go"
)

type categoryOrderWire struct {
	ID       string `json:"id"`
	Position *int64 `json:"position"`
}
type channelOrderWire struct {
	ID         string          `json:"id"`
	Position   *int64          `json:"position"`
	CategoryID json.RawMessage `json:"category_id"`
}

func decodeChannelOrder(w http.ResponseWriter, r *http.Request) (c.ChannelOrderInput, error) {
	var result c.ChannelOrderInput
	content, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || content != "application/json" {
		return result, fail(400, "json_required")
	}

	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768))
	var raw json.RawMessage
	if err = d.Decode(&raw); err != nil {
		var size *http.MaxBytesError
		if errors.As(err, &size) {
			return result, fail(413, "payload_too_large")
		}
		return result, fail(400, "invalid_body")
	}
	if d.Decode(new(any)) != io.EOF {
		return result, fail(400, "invalid_body")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return result, fail(400, "invalid_body")
	}
	for _, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return result, fail(400, "invalid_body")
		}
	}
	var input struct {
		Categories []categoryOrderWire `json:"categories"`
		Channels   []channelOrderWire  `json:"channels"`
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if strict.Decode(&input) != nil {
		return result, fail(400, "invalid_body")
	}
	if len(input.Categories) > 32 || len(input.Channels) > 100 || len(input.Categories)+len(input.Channels) == 0 {
		return result, fail(400, "invalid_channel_order")
	}
	seen := make(map[string]bool)
	categories := make([]c.CategoryOrderEntry, 0, len(input.Categories))
	channels := make([]c.ChannelOrderEntry, 0, len(input.Channels))
	for _, entry := range input.Categories {
		if !validID(entry.ID) || entry.Position == nil || !validPosition(*entry.Position) || seen[entry.ID] {
			return result, fail(400, "invalid_channel_order")
		}
		seen[entry.ID] = true
		categories = append(categories, c.CategoryOrderEntry{ID: entry.ID, Position: *entry.Position})
	}
	for _, entry := range input.Channels {
		if !validID(entry.ID) || entry.Position == nil || !validPosition(*entry.Position) || seen[entry.ID] {
			return result, fail(400, "invalid_channel_order")
		}
		seen[entry.ID] = true
		next := c.ChannelOrderEntry{ID: entry.ID, Position: *entry.Position}
		if entry.CategoryID != nil {
			var parent string
			if bytes.Equal(bytes.TrimSpace(entry.CategoryID), []byte("null")) || json.Unmarshal(entry.CategoryID, &parent) != nil || parent != "" && !validID(parent) {
				return result, fail(400, "invalid_channel_order")
			}
			next.CategoryID = &parent
		}
		channels = append(channels, next)
	}
	result.Categories = &categories
	result.Channels = &channels
	return result, nil
}

func (g *transaction) validateChannelOrder(input c.ChannelOrderInput) error {
	for _, entry := range *input.Categories {
		resource, ok := g.s.Categories[entry.ID]
		if !ok || resource.State != "ACTIVE" {
			return fail(404, "resource_not_found")
		}
		if err := g.require("MANAGE_CHANNEL", resource); err != nil {
			return err
		}
	}
	for _, entry := range *input.Channels {
		resource, ok := g.s.Channels[entry.ID]
		if !ok || resource.State != "ACTIVE" {
			return fail(404, "resource_not_found")
		}
		if err := g.require("MANAGE_CHANNEL", resource); err != nil {
			return err
		}
		if entry.CategoryID != nil && *entry.CategoryID != resource.CategoryID {
			if err := g.parent(*entry.CategoryID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (g *transaction) reorderChannels(w http.ResponseWriter) (int, any, error) {
	input, err := decodeChannelOrder(w, g.r)
	if err != nil {
		return 0, nil, err
	}

	if err = g.validateChannelOrder(input); err != nil {
		return 0, nil, err
	}
	for _, entry := range *input.Categories {
		if err = g.exec(`UPDATE guild.categories SET position=$2 WHERE id=$1 AND guild_id=$3`, entry.ID, entry.Position, g.g.ID); err != nil {
			return 0, nil, err
		}
	}
	for _, entry := range *input.Channels {
		if err = g.exec(`UPDATE guild.channels SET position=$2,category_id=CASE WHEN $3::text IS NULL THEN category_id ELSE nullif($3,'')::uuid END WHERE id=$1 AND guild_id=$4`, entry.ID, entry.Position, entry.CategoryID, g.g.ID); err != nil {
			return 0, nil, err
		}
	}
	if err = g.touch("channels.reordered", g.g.ID); err != nil {
		return 0, nil, err
	}
	return g.get()
}
