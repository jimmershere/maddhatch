package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/mux"
)

func TestGalleryManifestHandlerReturnsEntries(t *testing.T) {
	base := t.TempDir()
	galleryDir := filepath.Join(base, "chicks")
	if err := os.MkdirAll(galleryDir, 0o755); err != nil {
		t.Fatalf("mkdir gallery: %v", err)
	}

	files := []string{"b-chick.JPG", "a fluff.png", "notes.txt"}
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(galleryDir, name), []byte("test"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	handler := galleryManifestHandler(base)

	req := httptest.NewRequest(http.MethodGet, "/static/img/chicks/gallery.json", nil)
	req = mux.SetURLVars(req, map[string]string{"galleryPath": "chicks"})
	rr := httptest.NewRecorder()

	handler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload []galleryEntry
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if len(payload) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(payload))
	}

	if payload[0].Src != "/static/img/chicks/a fluff.png" {
		t.Fatalf("unexpected first src: %q", payload[0].Src)
	}

	if payload[0].Alt != "A Fluff" {
		t.Fatalf("unexpected alt text: %q", payload[0].Alt)
	}

	if payload[0].Caption != wittyCaption("chicks", "a fluff.png") {
		t.Fatalf("unexpected caption: %q", payload[0].Caption)
	}

	if payload[1].Src != "/static/img/chicks/b-chick.JPG" {
		t.Fatalf("unexpected second src: %q", payload[1].Src)
	}
}

func TestGalleryManifestHandlerRejectsTraversal(t *testing.T) {
	base := t.TempDir()
	handler := galleryManifestHandler(base)

	req := httptest.NewRequest(http.MethodGet, "/static/img/../secret/gallery.json", nil)
	req = mux.SetURLVars(req, map[string]string{"galleryPath": "../secret"})
	rr := httptest.NewRecorder()

	handler(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rr.Code)
	}
}

func TestGalleryManifestHandlerMissingDirectory(t *testing.T) {
	base := t.TempDir()
	handler := galleryManifestHandler(base)

	req := httptest.NewRequest(http.MethodGet, "/static/img/missing/gallery.json", nil)
	req = mux.SetURLVars(req, map[string]string{"galleryPath": "missing"})
	rr := httptest.NewRecorder()

	handler(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var payload []galleryEntry
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if len(payload) != 0 {
		t.Fatalf("expected empty payload, got %d entries", len(payload))
	}
}
