package main

import (
	"hash/fnv"
	"path/filepath"
	"strings"
)

var defaultQuips = []string{
	"Proof that snack time is a core memory in the making.",
	"Captured mid-glow-up and not even a little shy about it.",
	"Just casually auditioning for the farm-to-table runway.",
	"Serving up main-character energy without saying a word.",
	"A humble brag in photo form, really.",
}

var galleryQuips = map[string][]string{
	"jam": {
		"Toast just filed an official crush on this jar.",
		"Sunshine, sugar, and a jar that knows it’s the favorite.",
		"This spoonful is basically a standing ovation for berries.",
		"Jarred joy caught practicing its victory lap.",
		"Sweetness so dramatic it asked for its own encore.",
	},
	"chicks": {
		"Fluff level: expert. Life goals: nap and repeat.",
		"Freshly hatched and already plotting a coop takeover.",
		"Feathers ruffled by choice, not by chance.",
		"Tiny talons, big agenda, zero regrets.",
		"Still drying off, still stealing hearts.",
	},
	"chickens": {
		"Modeling the latest in pasture chic couture.",
		"Beak pointed at greatness, strut fully engaged.",
		"This bird woke up like this—unbothered and fabulous.",
		"Proof that coop royalty is absolutely a thing.",
		"Serving side-eye seasoned with pure charisma.",
	},
	"eggs": {
		"Breakfast’s backstage pass to the VIP skillet.",
		"Each shell hiding a sunny surprise with sass.",
		"Carton couture, assembled with farm-fresh flair.",
		"Eggs so dapper they demanded a photo shoot.",
		"The dozen that understood the assignment completely.",
	},
}

func wittyCaption(relativePath, fileName string) string {
	topLevel := strings.ToLower(filepath.ToSlash(relativePath))
	if topLevel == "" {
		topLevel = "."
	}

	if idx := strings.IndexRune(topLevel, '/'); idx >= 0 {
		topLevel = topLevel[:idx]
	}

	quips := galleryQuips[topLevel]
	if len(quips) == 0 {
		quips = defaultQuips
	}
	if len(quips) == 0 {
		return ""
	}

	key := strings.ToLower(filepath.ToSlash(filepath.Join(relativePath, fileName)))
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	index := h.Sum64() % uint64(len(quips))
	return quips[index]
}
