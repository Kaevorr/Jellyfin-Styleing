#!/usr/bin/env python3
"""Install or restore Jellyfin Cinematic through Jellyfin's Branding API."""

import argparse
import getpass
import json
import re
import sys
import tempfile
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

RAW_CSS = "https://raw.githubusercontent.com/Kaevorr/Jellyfin-Styleing/main/theme.css"
MAX_BYTES = 1_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = build_opener(NoRedirect())


def request(url, payload=None, token=None):
    headers = {"Cache-Control": "no-cache"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = (
            'MediaBrowser Client="Jellyfin Cinematic", Device="CLI", '
            f'DeviceId="jellyfin-cinematic", Version="1.0", Token="{token}"'
        )
    with opener.open(Request(url, data=body, headers=headers), timeout=30) as response:
        if body is not None and response.status != 204:
            raise ValueError(f"Unexpected write response (HTTP {response.status}).")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Response exceeded the installer size limit.")
    return data


def server_url(value):
    url = urlsplit(value.rstrip("/"))
    loopback = url.hostname in {"127.0.0.1", "localhost", "::1"}
    if (
        not url.hostname
        or url.username is not None
        or url.password is not None
        or url.query
        or url.fragment
        or (url.scheme != "https" and not (url.scheme == "http" and loopback))
    ):
        raise ValueError("Use your Jellyfin HTTPS base URL or a loopback HTTP URL.")
    return url.geturl()


def setup(args):
    base = server_url(args.server)
    info = json.loads(request(base + "/System/Info/Public"))
    version = info.get("Version") if isinstance(info, dict) else None
    if not isinstance(version, str) or not re.fullmatch(r"10\.11\.\d+", version):
        raise ValueError(f"This installer targets Jellyfin Server 10.11.x. Reported version: {version!r}.")

    if args.restore:
        with args.restore.open("rb") as backup:
            data = backup.read(MAX_BYTES + 1)
    else:
        data = request(RAW_CSS)
        if not data.startswith(b"/* Jellyfin Cinematic ") or b"--jfc-theme-version:" not in data:
            raise ValueError("GitHub did not return the expected theme stylesheet.")
    if len(data) > MAX_BYTES:
        raise ValueError("Stylesheet exceeded the installer size limit.")
    css = data.decode("utf-8")

    def read_branding():
        branding = json.loads(request(base + "/Branding/Configuration"))
        if (
            not isinstance(branding, dict)
            or not isinstance(branding.get("SplashscreenEnabled"), bool)
            or any(branding.get(field) is not None and not isinstance(branding[field], str)
                   for field in ("CustomCss", "LoginDisclaimer"))
        ):
            raise ValueError("Jellyfin returned an unexpected Branding configuration.")
        return {
            "CustomCss": branding.get("CustomCss") or "",
            "LoginDisclaimer": branding.get("LoginDisclaimer"),
            "SplashscreenEnabled": branding["SplashscreenEnabled"],
        }

    current = read_branding()
    if current["CustomCss"] == css:
        print("This stylesheet is already installed.")
        return

    if not sys.stdin.isatty():
        raise ValueError("Run the installer in an interactive terminal to enter your API key.")
    token = getpass.getpass("Jellyfin API key: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9._~-]+", token):
        raise ValueError("Enter a valid Jellyfin API key.")

    directory = Path.home() / ".jellyfin-cinematic"
    directory.mkdir(mode=0o700, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="branding-", dir=directory)) / "previous.css"
    backup.write_bytes(current["CustomCss"].encode("utf-8"))
    print(f"Previous CSS saved to {backup}", flush=True)

    if read_branding() != current:
        raise ValueError("Branding changed while the installer was running. Run it again.")
    updated = {**current, "CustomCss": css}
    request(base + "/System/Configuration/Branding", updated, token)
    if read_branding() != updated:
        raise ValueError("The write could not be verified. Check Branding and keep the backup.")
    print("Jellyfin confirmed the CSS change. Reload your browser.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("server", help="Jellyfin base URL, without /web")
    parser.add_argument("--restore", type=Path, help="restore a previous.css backup")
    try:
        setup(parser.parse_args())
    except (URLError, OSError, ValueError) as error:
        print(f"Install stopped: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
