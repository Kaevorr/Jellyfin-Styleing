#!/bin/sh
set -eu
umask 022

repository=https://github.com/Kaevorr/Jellyfin-Styleing.git
root=${JFC_ROOT:-/var/www/jellyfin-cinematic}
mode=${1:-sync}
case "$mode" in sync|--rollback) ;; *) printf '%s\n' 'Usage: sync-nginx.sh [--rollback]' >&2; exit 2 ;; esac
case "$root" in /*) ;; *) printf '%s\n' 'JFC_ROOT must be an absolute path.' >&2; exit 2 ;; esac

mkdir -p -- "$root/releases"
exec 9>"$root/.sync.lock"
flock -n 9 || { printf '%s\n' 'Another Cinematic sync is running.' >&2; exit 1; }
work=$(mktemp -d -- "$root/.sync.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

fail() {
    printf 'Cinematic sync: %s\n' "$*" >&2
    exit 1
}

valid_target() {
    printf '%s\n' "$1" | grep -Eq '^releases/[0-9a-f]{40}$' && [ -d "$root/$1" ]
}

switch_to() {
    target=$1
    valid_target "$target" || fail 'Invalid or missing release.'
    old=$(readlink "$root/current" || :)
    if [ "$old" = "$target" ]; then
        printf 'Already serving %s\n' "$target"
        return
    fi
    if [ -n "$old" ]; then
        valid_target "$old" || fail 'Invalid current release link.'
        ln -s -- "$old" "$work/previous"
        mv -Tf -- "$work/previous" "$root/previous"
    fi
    ln -s -- "$target" "$work/current"
    mv -Tf -- "$work/current" "$root/current"
    printf 'Now serving %s from %s/current\n' "$target" "$root"
}

if [ "$mode" = '--rollback' ]; then
    previous=$(readlink "$root/previous") || fail 'No previous release is recorded.'
    switch_to "$previous"
    exit 0
fi

export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
git init --bare --quiet "$work/git"
git -C "$work/git" -c protocol.allow=never -c protocol.https.allow=always \
    fetch --quiet --no-tags --depth=1 "$repository" refs/heads/main || fail 'GitHub download failed.'
revision=$(git -C "$work/git" rev-parse --verify 'FETCH_HEAD^{commit}')
target=releases/$revision

files='theme.css
js/enhancements.js
assets/hero/home-crimson.svg
assets/hero/music-moon.svg
assets/icons/movies.svg
assets/icons/shows.svg
assets/icons/music.svg'
printf '%s\n' "$files" | while IFS= read -r file; do
    mkdir -p -- "$work/dist/$(dirname "$file")"
    git -C "$work/git" show "$revision:$file" > "$work/dist/$file" || fail "Missing $file."
    [ -s "$work/dist/$file" ] || fail "Empty $file."
done

python3 - "$work/dist" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1])
css = (root / "theme.css").read_text(encoding="utf-8")
js = (root / "js/enhancements.js").read_text(encoding="utf-8")
if not css.startswith("/* Jellyfin Cinematic ") or not re.search(r"--jfc-theme-version:\s*\d+;", css):
    sys.exit("Cinematic sync: unexpected stylesheet.")
if "jellyfin-cinematic.enhancements" not in js or "JellyfinCinematic" not in js:
    sys.exit("Cinematic sync: unexpected enhancement script.")
for reference in re.findall(r'url\("\./(assets/[^"]+)"\)', css):
    if not root.joinpath(reference).is_file():
        sys.exit(f"Cinematic sync: missing asset {reference}.")
for image in root.glob("assets/*/*.svg"):
    if ET.parse(image).getroot().tag != "{http://www.w3.org/2000/svg}svg":
        sys.exit(f"Cinematic sync: invalid SVG {image.name}.")
PY
if command -v node >/dev/null 2>&1; then
    node --check "$work/dist/js/enhancements.js" || fail 'Enhancement syntax check failed.'
fi

if [ -d "$root/$target" ]; then
    diff -qr -- "$work/dist" "$root/$target" || fail 'An existing release differs from GitHub.'
else
    mv -T -- "$work/dist" "$root/$target"
fi
switch_to "$target"
