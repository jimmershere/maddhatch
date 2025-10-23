package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gorilla/mux"
)

type galleryEntry struct {
	Src     string `json:"src"`
	Alt     string `json:"alt,omitempty"`
	Caption string `json:"caption,omitempty"`
}

func galleryManifestHandler(baseDir string) http.HandlerFunc {
	absoluteBase, err := filepath.Abs(baseDir)
	if err != nil {
		log.Printf("gallery manifest disabled: %v", err)
		return func(w http.ResponseWriter, r *http.Request) {
			respondError(w, http.StatusInternalServerError, "gallery unavailable")
		}
	}

	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		galleryPath := strings.Trim(vars["galleryPath"], "/")

		// Empty path means no gallery to load; return empty list gracefully.
		if galleryPath == "" {
			respondJSON(w, http.StatusOK, []galleryEntry{})
			return
		}

		cleaned := filepath.Clean(galleryPath)
		if cleaned == "." || strings.HasPrefix(cleaned, "..") {
			respondError(w, http.StatusBadRequest, "invalid gallery path")
			return
		}

		targetDir := filepath.Join(absoluteBase, cleaned)
		if !strings.HasPrefix(targetDir, absoluteBase) {
			respondError(w, http.StatusBadRequest, "invalid gallery path")
			return
		}

		entries, err := buildGalleryEntries(absoluteBase, cleaned)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				respondJSON(w, http.StatusOK, []galleryEntry{})
				return
			}
			log.Printf("gallery manifest error for %q: %v", galleryPath, err)
			respondError(w, http.StatusInternalServerError, "gallery unavailable")
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		respondJSON(w, http.StatusOK, entries)
	}
}

func buildGalleryEntries(baseDir, relativePath string) ([]galleryEntry, error) {
	directory := filepath.Join(baseDir, relativePath)

	items, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}

	var files []os.DirEntry
	for _, item := range items {
		if item.IsDir() {
			continue
		}
		if !isImageFile(item.Name()) {
			continue
		}
		files = append(files, item)
	}

	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].Name()) < strings.ToLower(files[j].Name())
	})

	webBase := "/static/img"
	if relativePath != "" {
		webBase = path.Join(webBase, filepath.ToSlash(relativePath))
	}

	entries := make([]galleryEntry, 0, len(files))
	for _, file := range files {
		name := file.Name()
		src := path.Join(webBase, name)
		title := humaniseFilename(name)
		entry := galleryEntry{Src: src}
		if title != "" {
			entry.Alt = title
			entry.Caption = title
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

func isImageFile(name string) bool {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"), strings.HasSuffix(lower, ".png"),
		strings.HasSuffix(lower, ".gif"), strings.HasSuffix(lower, ".webp"), strings.HasSuffix(lower, ".avif"),
		strings.HasSuffix(lower, ".bmp"), strings.HasSuffix(lower, ".tiff"), strings.HasSuffix(lower, ".svg"):
		return true
	default:
		return false
	}
}

func humaniseFilename(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.ReplaceAll(base, "_", " ")
	base = strings.ReplaceAll(base, "-", " ")
	base = strings.ReplaceAll(base, ".", " ")
	base = strings.TrimSpace(base)
	if base == "" {
		return ""
	}

	fields := strings.Fields(base)
	for i, word := range fields {
		if len(word) == 0 {
			continue
		}
		fields[i] = strings.ToUpper(word[:1]) + strings.ToLower(word[1:])
	}

	return strings.Join(fields, " ")
}
