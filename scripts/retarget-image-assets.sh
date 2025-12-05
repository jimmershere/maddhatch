#!/usr/bin/env bash
set -euo pipefail

# Retarget image references in selected HTML files to assets under
# ./frontend_go/public/assets/trish_site_assets.
# SVG references are shifted to PNG (or other raster formats) when possible.

TARGET_ROOT=${TARGET_ROOT:-"./frontend_go/public/assets/trish_site_assets"}
HTML_FILES=(
  "./frontend_go/public/index.html"
  "./frontend_go/public/login.html"
  "./frontend_go/public/order.html"
  "./frontend_go/public/eating-eggs.html"
  "./frontend_go/public/chicks-eggs.html"
  "./frontend_go/public/merch.html"
  "./frontend_go/public/admin.html"
  "./frontend_go/public/support.html"
  "./frontend_go/public/chicks.html"
  "./frontend_go/public/assets/trish_site_assets/snippet.html"
  "./frontend_go/public/hatching-eggs.html"
  "./frontend_go/public/grown-birds.html"
  "./frontend_go/public/t-shirt.html"
  "./frontend_go/public/house-jams.html"
  "./rbac/app/templates/login.html"
)

ASSET_EXTENSIONS=(png jpg jpeg webp)
DRY_RUN=${DRY_RUN:-0}

declare -A asset_index
build_asset_index() {
  for ext in "${ASSET_EXTENSIONS[@]}"; do
    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      base="$(basename "${path%.*}")"
      key="${ext,,}:${base,,}"
      rel_path="/${path#./frontend_go/public/}"
      asset_index[$key]="$rel_path"
    done < <(find "$TARGET_ROOT" -type f -iname "*.${ext}" | sort)
  done
}

write_index_file() {
  local index_file
  index_file=$(mktemp)
  for key in "${!asset_index[@]}"; do
    printf '%s\t%s\n' "$key" "${asset_index[$key]}" >>"$index_file"
  done
  echo "$index_file"
}

process_files() {
  local index_file="$1"
  shift
  python3 - "$index_file" "$DRY_RUN" "$@" <<'PY'
import pathlib
import re
import sys
from typing import Dict, Iterable

index_path = pathlib.Path(sys.argv[1])
dry_run = sys.argv[2] == "1"
files: Iterable[str] = sys.argv[3:]

asset_map: Dict[str, Dict[str, str]] = {}
for line in index_path.read_text().splitlines():
    key, value = line.split("\t", 1)
    ext, base = key.split(":", 1)
    asset_map.setdefault(base, {})[ext] = value

pattern = re.compile(r"[^\"'\s>]+\.(?:png|jpe?g|svg)", re.IGNORECASE)


def preferred_extensions(original_ext: str) -> Iterable[str]:
    ext = original_ext.lower()
    if ext == "svg":
        return ("png", "jpg", "jpeg", "webp")
    if ext in ("jpg", "jpeg"):
        return ("jpg", "jpeg", "webp", "png")
    if ext == "png":
        return ("png", "webp", "jpg", "jpeg")
    return ("png", "jpg", "jpeg", "webp")


def replacement_for(path: str) -> str | None:
    name_part = path.split("/")[-1]
    base, ext = name_part.rsplit(".", 1)
    base = base.lower()
    for candidate_ext in preferred_extensions(ext):
        candidate = asset_map.get(base, {}).get(candidate_ext)
        if candidate:
            return candidate
    return None


for file_name in files:
    file_path = pathlib.Path(file_name)
    if not file_path.exists():
        print(f"[skip] missing file {file_name}")
        continue

    original = file_path.read_text()
    replacements: Dict[str, str] = {}
    for match in set(pattern.findall(original)):
        replacement = replacement_for(match)
        if replacement and replacement != match:
            replacements[match] = replacement
        elif not replacement:
            print(f"[warn] no replacement for {match} in {file_name}")

    if not replacements:
        print(f"[noop] {file_name}")
        continue

    updated = original
    for old, new in replacements.items():
        updated = updated.replace(old, new)

    if dry_run:
        print(f"[dry-run] {file_name}: {len(replacements)} substitutions")
        continue

    file_path.write_text(updated)
    print(f"[updated] {file_name}: {len(replacements)} substitutions")
PY
}

main() {
  build_asset_index
  index_file=$(write_index_file)
  trap 'rm -f "$index_file"' EXIT

  if [[ ${#asset_index[@]} -eq 0 ]]; then
    echo "No assets found under $TARGET_ROOT" >&2
    exit 1
  fi

  process_files "$index_file" "${HTML_FILES[@]}"
}

main "$@"
