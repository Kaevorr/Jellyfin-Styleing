#!/bin/sh
set -eu
umask 077

repo=https://github.com/Kaevorr/Jellyfin-Styleing.git
raw=https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing
destination=${1:-./cinematic-updates}

if [ "$#" -gt 1 ]; then
    printf '%s\n' 'Usage: sh optional-sync.sh [output-directory]' >&2
    exit 2
fi

refs=$(git ls-remote --exit-code "$repo" refs/heads/main)
revision=$(printf '%s\n' "$refs" | awk 'NR == 1 { print $1 }')
case "$revision" in
    ''|*[!a-f0-9]*) printf '%s\n' 'Invalid GitHub main revision.' >&2; exit 1 ;;
esac
[ "${#revision}" -eq 40 ] || exit 1

mkdir -p -- "$destination"
stage=$(mktemp -d -- "$destination/.download.XXXXXXXX")
trap 'rm -f -- "$stage/theme.css" "$stage/enhancements.js" "$stage/REVISION"; rmdir -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM
fetch() {
    curl --disable --silent --show-error --fail --proto '=https' \
        --connect-timeout 15 --max-time 120 --output "$2" "$raw/$revision/$1"
}
fetch theme.css "$stage/theme.css"
fetch js/enhancements.js "$stage/enhancements.js"
grep -Fq -- '--jfc-theme-version:' "$stage/theme.css"
grep -Fq 'jellyfin-cinematic.enhancements' "$stage/enhancements.js"
printf '%s\n' "$revision" > "$stage/REVISION"

release=$destination/$revision
if [ -d "$release" ]; then
    cmp "$stage/theme.css" "$release/theme.css"
    cmp "$stage/enhancements.js" "$release/enhancements.js"
    cmp "$stage/REVISION" "$release/REVISION"
    printf 'Already staged at %s\n' "$release"
else
    mv -T -- "$stage" "$release"
    trap - EXIT
    printf 'Staged at %s\n' "$release"
fi
