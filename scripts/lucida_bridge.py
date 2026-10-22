import json
import asyncio
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from html.parser import HTMLParser
from http.client import HTTPSConnection
from urllib.parse import urlencode, unquote, urlparse, parse_qs, quote

import json5


def launch(engine):
    for channel in ["msedge", "chrome"]:
        try:
            return engine.launch(channel=channel, headless=True, args=["--enable-features=ParallelDownloading"])
        except Exception:
            pass
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True, timeout=240, stdout=sys.stderr)
    return engine.launch(headless=True, args=["--enable-features=ParallelDownloading"])


def page_data(html):
    for script in re.findall(r"<script[^>]*>(.*?)</script>", html, re.S):
        match = re.search(r"const data = (\[.*\]);\s*Promise\.all", script, re.S)
        if match:
            payload = match.group(1)
            depth, start, end = 0, 1, len(payload) - 1
            for token in re.finditer(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|[{}\[\],]', payload, re.S):
                value = token.group()
                if value in ["[", "{"]:
                    depth += 1
                elif value in ["]", "}"]:
                    depth -= 1
                    if depth == 0:
                        end = token.start()
                        break
                elif value == "," and depth == 1:
                    start = token.end()
            try:
                return json5.loads(payload[start:end])["data"]
            except (ValueError, KeyError, TypeError):
                return json5.loads(payload)[-1]["data"]
    raise RuntimeError("Lucida returned an unsupported page format")


def data_from(page, html):
    try:
        return page_data(html)
    except RuntimeError:
        return page_data("".join("<script>" + script + "</script>" for script in page.locator("script").all_text_contents()))


class Services(HTMLParser):
    def __init__(self):
        super().__init__()
        self.selected = False
        self.values = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "select":
            self.selected = values.get("name") == "service"
        if tag == "option" and self.selected and re.fullmatch(r"[a-z0-9]+", values.get("value", "")):
            self.values.append(values["value"])

    def handle_endtag(self, tag):
        if tag == "select":
            self.selected = False


def http_text(path):
    request = Request("https://lucida.to" + path, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html,application/json", "Accept-Encoding": "identity"})
    with urlopen(request, timeout=6) as response:
        if urlparse(response.url).hostname != "lucida.to":
            raise RuntimeError("Unexpected catalog redirect")
        body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise RuntimeError("Catalog response too large")
        return body.decode("utf-8")


def stream_request(connection, path, payload=None):
    headers = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity", "Accept": "application/json,text/html", "Origin": "https://lucida.to", "Referer": "https://lucida.to/"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    connection.request("GET" if payload is None else "POST", path, body=None if payload is None else json.dumps(payload).encode(), headers=headers)
    response = connection.getresponse()
    body = response.read(8 * 1024 * 1024 + 1)
    if response.status != 200 or len(body) > 8 * 1024 * 1024:
        raise RuntimeError(f"Lucida returned HTTP {response.status}")
    return body


def http_stream(value):
    started = time.monotonic()
    connection = HTTPSConnection("lucida.to", timeout=6)
    data = page_data(stream_request(connection, "/?" + urlencode({"url": value})).decode("utf-8"))
    metadata_ready = time.monotonic()
    info = data.get("info", {})
    if not info.get("success"):
        raise RuntimeError(str(info.get("error", "Recording is unavailable")))
    payload = {
        "account": {"id": "auto", "type": "country"},
        "compat": False, "downscale": "original", "handoff": True,
        "metadata": False, "private": True, "upload": {"enabled": False},
        "token": {"expiry": data.get("tokenExpiry"), "primary": data.get("token"), "secondary": info.get("csrfFallback")},
        "url": info.get("url", value),
    }
    result = json.loads(stream_request(connection, "/api/load?url=%2Fapi%2Ffetch%2Fstream%2Fv2", payload))
    connection.close()
    requested = time.monotonic()
    server, handoff = result.get("server", ""), result.get("handoff", "")
    if not re.fullmatch(r"[a-zA-Z0-9-]+", server) or not re.fullmatch(r"[a-zA-Z0-9_-]+", handoff):
        raise RuntimeError(str(result.get("error", "Invalid stream handoff")))
    base = "https://" + server + ".lucida.to/api/fetch/request/" + handoff
    connection = HTTPSConnection(server + ".lucida.to", timeout=3)
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        status = json.loads(stream_request(connection, "/api/fetch/request/" + handoff))
        if status.get("status") == "completed":
            stream_url = base + "/download"
            connection.close()
            return {"url": stream_url, "format": "Audio", "hls": False, "duration": info.get("durationMs", 0) / 1000, "timings": {"metadataMs": round((metadata_ready - started) * 1000), "requestMs": round((requested - metadata_ready) * 1000), "processingMs": round((time.monotonic() - requested) * 1000)}}
        if status.get("status") in ["error", "failed"]:
            raise RuntimeError(str(status.get("message", "Stream preparation failed")))
        time.sleep(0.25)
    raise RuntimeError("Stream preparation timed out")


def http_search_all(query, only=None):
    if only and only != "others":
        services = [only]
    else:
        options = Services()
        options.feed(http_text("/"))
        services = options.values
        if not services:
            raise RuntimeError("No catalog services returned")
        if only == "others":
            services = [service for service in services if service not in ["amazon", "soundcloud"]]
    def search_service(service):
        try:
            countries = json.loads(http_text("/api/load?" + urlencode({"url": "/api/countries?service=" + service}))).get("countries", [])
            if not countries:
                return {"service": service, "error": "No servers available for this service", "tracks": []}
            country = next((entry["code"] for entry in countries if entry["code"] == "US"), countries[0]["code"])
            terms = query.split()
            cleaned = " ".join(re.sub(r"\([^)]*\)", " ", query).split())
            queries = [cleaned, query]
            if service != "soundcloud" and len(terms) >= 3:
                split = (len(terms) + 1) // 2
                queries += [" ".join(terms[split:]), " ".join(terms[:split])]
            tracks = {}
            for term in dict.fromkeys(queries):
                data = page_data(http_text("/search?" + urlencode({"query": term, "service": service, "country": country}))).get("results", {})
                if not data.get("success"):
                    return {"service": service, "error": str(data.get("error", "Search unavailable")), "tracks": []}
                for track in data.get("results", {}).get("tracks", [])[:25]:
                    tracks[track.get("url", str(track.get("id")))] = {**track, "service": service, "country": country}
                if service == "amazon" and tracks:
                    break
            return {"service": service, "country": country, "tracks": list(tracks.values())}
        except Exception as error:
            return {"service": service, "error": str(error), "tracks": [], "browserRequired": True}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(search_service, services))
    if any(result.get("browserRequired") for result in results):
        raise RuntimeError("Catalog needs browser fallback")
    return {"tracks": [track for result in results for track in result["tracks"]], "catalogs": [{k: v for k, v in result.items() if k != "tracks"} | {"count": len(result["tracks"])} for result in results]}


async def search_all(query, only=None):
    from playwright.async_api import async_playwright
    async with async_playwright() as runtime:
        browser = None
        for channel in ["msedge", "chrome", None]:
            try:
                browser = await runtime.chromium.launch(channel=channel, headless=True, args=["--enable-features=ParallelDownloading"])
                break
            except Exception:
                pass
        if browser is None:
            subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True, timeout=240, stdout=sys.stderr)
            browser = await runtime.chromium.launch(headless=True, args=["--enable-features=ParallelDownloading"])
        try:
            context = await browser.new_context(locale="en-US")
            home = await context.new_page()
            await home.goto("https://lucida.to/", wait_until="domcontentloaded", timeout=45000)
            await home.locator("select[name=service]").wait_for()
            services = await home.locator("select[name=service] option").evaluate_all("es => es.map(e => e.value).filter(v => /^[a-z0-9]+$/.test(v))")
            services = ([service for service in services if service not in ["amazon", "soundcloud"]] if only == "others" else [service for service in services if service == only]) if only else sorted(services, key=lambda service: (service != "amazon", service == "soundcloud"))
            semaphore = asyncio.Semaphore(3)
            async def search_service(service):
                async with semaphore:
                    page = None
                    try:
                        countries_response = await context.request.get("https://lucida.to/api/load?" + urlencode({"url": "/api/countries?service=" + service}), timeout=20000)
                        countries_data = await countries_response.json()
                        countries = countries_data.get("countries", [])
                        if not countries:
                            return {"service": service, "error": "No servers available for this service", "tracks": []}
                        country = next((entry["code"] for entry in countries if entry["code"] == "US"), countries[0]["code"])
                        page = await context.new_page()
                        terms = query.split()
                        cleaned_query = re.sub(r"\([^)]*\)", " ", query)
                        cleaned_query = " ".join(cleaned_query.split())
                        queries = list(dict.fromkeys([cleaned_query, query]))
                        if service != "soundcloud" and len(terms) >= 3:
                            split = (len(terms) + 1) // 2
                            queries += [" ".join(terms[split:]), " ".join(terms[:split])]
                        tracks = {}
                        for search_query in dict.fromkeys(queries):
                            response = await page.goto("https://lucida.to/search?" + urlencode({"query": search_query, "service": service, "country": country}), wait_until="domcontentloaded", timeout=45000)
                            if not response or response.status != 200:
                                raise RuntimeError("Search is temporarily unavailable")
                            html = await response.text()
                            data = None
                            for script in re.findall(r"<script[^>]*>(.*?)</script>", html, re.S):
                                match = re.search(r"const data = (\[.*\]);\s*Promise\.all", script, re.S)
                                if match:
                                    data = json5.loads(match.group(1))[-1]["data"].get("results", {})
                                    break
                            if not data or not data.get("success"):
                                raise RuntimeError(str((data or {}).get("error", "Invalid search response")))
                            for track in data.get("results", {}).get("tracks", [])[:25]:
                                tracks[track.get("url", str(track.get("id")))] = {**track, "service": service, "country": country}
                            if service == "amazon" and tracks:
                                break
                        return {"service": service, "country": country, "tracks": list(tracks.values())}
                    except Exception as error:
                        return {"service": service, "error": str(error), "tracks": []}
                    finally:
                        if page is not None:
                            await page.close()
            results = await asyncio.gather(*(search_service(service) for service in services))
            return {"tracks": [track for result in results for track in result["tracks"]], "catalogs": [{k: v for k, v in result.items() if k != "tracks"} | {"count": len(result["tracks"])} for result in results]}
        finally:
            await browser.close()


def execute():
    action, value, target = sys.argv[1:4]
    if action == "stream":
        return http_stream(value)
    if action == "search" and target in ["all", "amazon", "others"]:
        service = None if target == "all" else target
        try:
            return http_search_all(value, service)
        except Exception:
            return asyncio.run(search_all(value, service))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as runtime:
        browser = launch(runtime.chromium)
        try:
            context = browser.new_context(accept_downloads=True, locale="en-US")
            page = context.new_page()
            page.set_default_timeout(30000)
            if action == "apple_recordings":
                request = json.loads(value)
                page.goto("https://music.apple.com/us/search?" + urlencode({"term": request["artist"] + " " + request["title"]}), wait_until="domcontentloaded", timeout=20000)
                links = page.locator('a[href*="?i="]').evaluate_all("nodes => nodes.map(node => node.href)")
                if not links:
                    try:
                        page.locator('a[href*="?i="]').first.wait_for(timeout=7000)
                        links = page.locator('a[href*="?i="]').evaluate_all("nodes => nodes.map(node => node.href)")
                    except Exception:
                        return []
                return list(dict.fromkeys(match.group(1) for link in links for match in [re.search(r"[?&]i=(\d+)", link)] if match))[:4]
            if action == "spotify_metadata":
                request = json.loads(value)
                normalize = lambda text: " ".join(re.sub(r"[^\w]+", " ", str(text).casefold()).split())
                title = normalize(request["title"])
                artists = [normalize(name) for name in re.split(r"\s*[,;&]\s*", request["artist"])]
                page.goto("https://open.spotify.com/search/" + quote(request["artist"] + " " + request["title"]), wait_until="domcontentloaded", timeout=15000)
                try:
                    page.locator('a[href*="/track/"]').first.wait_for(timeout=8000)
                except Exception:
                    return {}
                links = page.locator('a[href*="/track/"]').evaluate_all("nodes => nodes.map(node => ({url: node.href, title: node.textContent}))")
                ids = list(dict.fromkeys(match.group(1) for link in links if normalize(link["title"]) == title for match in [re.search(r"/track/([A-Za-z0-9]{22})", link["url"])] if match))[:4]
                matches = []
                for track_id in ids:
                    response = context.request.get("https://open.spotify.com/embed/track/" + track_id, timeout=6000)
                    if response.status != 200:
                        continue
                    script = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', response.text())
                    if not script:
                        continue
                    entity = json.loads(script.group(1)).get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                    candidates = [normalize(artist.get("name", "")) for artist in entity.get("artists", [])]
                    if normalize(entity.get("name", "")) == title and all(artist in candidates for artist in artists) and abs(entity.get("duration", 0) / 1000 - request["duration"]) <= 3:
                        matches.append({"id": track_id, "title": entity["name"], "duration": entity["duration"] / 1000, "artists": candidates})
                return matches[0] if len(matches) == 1 else {}
            if action == "lyrics":
                origins = {"betterlyrics": "https://api.betterlyrics.org", "lyricsplus": "https://lyricsplus.binimum.org", "lrcmux": "https://api.lrcmux.dev", "rmmrevival": "https://lyrics.rmmreviv.al"}
                if target not in origins or not value.startswith(("/getLyrics?", "/v2/lyrics/get?", "/get?", "/lyrics?id=")):
                    raise RuntimeError("Unsupported lyrics request")
                response = page.goto(origins[target] + value, wait_until="domcontentloaded", timeout=30000)
                if not response or response.status != 200:
                    raise RuntimeError(f"Lyrics service returned HTTP {response.status if response else 0}")
                return response.json()
            if action == "search":
                if target not in ["qobuz", "soundcloud", "yandex", "tidal"]:
                    raise RuntimeError("Unsupported music service")
                url = "https://lucida.to/search?" + urlencode({"query": value, "service": target, "country": "XX" if target == "soundcloud" else "US"})
            elif action in ["download", "stream"]:
                url = "https://lucida.to/?" + urlencode({"url": value})
            else:
                raise RuntimeError("Unsupported music operation")
            response = page.goto(url, wait_until="domcontentloaded", timeout=10000 if action == "stream" else 45000)
            if not response or response.status != 200:
                raise RuntimeError(f"Lucida is unavailable (HTTP {response.status if response else 'unknown'})")
            if action == "search":
                result = data_from(page, response.text()).get("results", {})
                if not result.get("success"):
                    raise RuntimeError(str(result.get("error", "Lucida search failed")))
                return {"tracks": result.get("results", {}).get("tracks", []), "service": target}
            page.locator("button.download-button").wait_for(state="visible", timeout=5000 if action == "stream" else 30000)
            convert = page.locator("#convert")
            if convert.count():
                convert.select_option("original")
            private = page.locator("#hide-from-ticker")
            if private.count():
                private.check()
            external = page.locator("#external-enable")
            if external.count() and external.is_checked():
                external.uncheck()
            if action == "stream":
                captured = []
                def intercept(route):
                    requested = route.request.url
                    if route.request.is_navigation_request() and "/api/fetch/request/" in unquote(requested) and "/download" in unquote(requested):
                        captured.append(requested)
                        route.abort()
                    else:
                        route.continue_()
                page.route("**/*", intercept)
                page.locator("button.download-button").click()
                import time
                deadline = time.monotonic() + 6
                while not captured and time.monotonic() < deadline:
                    page.wait_for_timeout(100)
                if not captured:
                    raise RuntimeError("The music service did not prepare a stream in time")
                params = parse_qs(urlparse(captured[0]).query)
                name = params.get("force", [""])[0]
                suffix = Path(name).suffix.lower()
                audio_format = {".flac": "FLAC", ".m4a": "AAC", ".mp3": "MP3", ".ogg": "OGG", ".opus": "OPUS"}.get(suffix, "Audio")
                try:
                    headers = context.request.head(captured[0], timeout=2500).headers
                    mime = headers.get("content-type", "").split(";")[0].lower()
                    audio_format = {"audio/flac": "FLAC", "audio/x-flac": "FLAC", "audio/mpeg": "MP3", "audio/mp4": "AAC", "audio/aac": "AAC", "audio/ogg": "OGG"}.get(mime, audio_format)
                except Exception:
                    pass
                return {"url": captured[0], "format": audio_format, "hls": False}
            with page.expect_download(timeout=150000) as pending:
                page.locator("button.download-button").click()
            download = pending.value
            suffix = Path(download.suggested_filename).suffix.lower()
            if suffix not in [".flac", ".m4a", ".mp3", ".ogg", ".opus", ".webm", ".wav"]:
                download.cancel()
                raise RuntimeError("Lucida did not return a single supported audio file")
            if action == "stream":
                url = download.url
                download.cancel()
                return {"url": url, "format": {".flac": "FLAC", ".m4a": "AAC", ".mp3": "MP3", ".ogg": "OGG", ".opus": "OPUS"}.get(suffix, "Audio"), "hls": False}
            path = Path(target).with_suffix(".lucida" + suffix)
            download.save_as(str(path))
            if download.failure():
                raise RuntimeError("Lucida download failed")
            return {"path": str(path)}
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        print(json.dumps(execute(), ensure_ascii=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
