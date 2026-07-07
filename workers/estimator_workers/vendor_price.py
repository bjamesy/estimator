"""Vendor product-page price extraction.

Small per-vendor extraction, not a generic scraper (see
docs/v2/plans/05-vendor-price-check-plan.md): fetch one saved product
URL and read the listed price from structured data (JSON-LD Product
offers, then price meta tags, then itemprop). Expected to break when a
vendor changes their site -- every failure degrades to 'unverifiable',
never an error surfaced into the estimate.

Security: the host allowlist below is the SSRF guard -- arbitrary URLs
are rejected at save time (web/src/lib/vendors.ts, keep the two lists
in sync) AND again here at fetch time. https only, response size capped,
short timeout, no crawling -- one user-initiated fetch per check.
"""

import json
import os
import re

import httpx
from bs4 import BeautifulSoup

# Keep in sync with web/src/lib/vendors.ts. Start with the vendors most
# common among early contractor users; extending is a one-line change
# in both lists plus (usually) nothing else, since extraction reads
# standard structured data.
ALLOWED_VENDOR_HOSTS = {
    "homedepot.ca",
    "www.homedepot.ca",
    "rona.ca",
    "www.rona.ca",
    "homehardware.ca",
    "www.homehardware.ca",
}

# Dev/verification escape hatch: a single extra host (e.g. a local
# fixture server) can be allowed via env. Never set in production.
_test_host = os.environ.get("VENDOR_PRICE_TEST_HOST")
if _test_host:
    ALLOWED_VENDOR_HOSTS = ALLOWED_VENDOR_HOSTS | {_test_host}

MAX_RESPONSE_BYTES = 3 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 15

USER_AGENT = "EstimatorPriceCheck/1.0 (single-item price verification; not a crawler)"


class PriceCheckFailure(Exception):
    """Any reason the current price couldn't be verified -- callers
    record 'unverifiable' and move on."""


def validate_vendor_url(url: str) -> None:
    parsed = httpx.URL(url)
    scheme_ok = parsed.scheme == "https" or (
        # http allowed only for the dev fixture host
        _test_host and parsed.host == _test_host and parsed.scheme == "http"
    )
    if not scheme_ok:
        raise PriceCheckFailure("Only https product URLs are supported.")
    if parsed.host not in ALLOWED_VENDOR_HOSTS:
        raise PriceCheckFailure(f"Host not in the supported vendor list: {parsed.host}")


def fetch_page(url: str) -> str:
    validate_vendor_url(url)
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            max_redirects=3,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        ) as client:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise PriceCheckFailure(f"Vendor page returned HTTP {response.status_code}.")
                # Redirects must stay on allowed hosts too.
                if response.url.host not in ALLOWED_VENDOR_HOSTS:
                    raise PriceCheckFailure("Vendor page redirected off the supported host.")
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise PriceCheckFailure("Vendor page too large.")
                    chunks.append(chunk)
                return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
    except PriceCheckFailure:
        raise
    except Exception as exc:
        raise PriceCheckFailure(f"Fetch failed: {exc}") from exc


def _price_from_jsonld(soup: BeautifulSoup) -> float | None:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for node in candidates:
            if not isinstance(node, dict):
                continue
            # Product may be nested under @graph.
            graph = node.get("@graph")
            nodes = graph if isinstance(graph, list) else [node]
            for item in nodes:
                if not isinstance(item, dict) or item.get("@type") not in ("Product", ["Product"]):
                    continue
                offers = item.get("offers")
                offers_list = offers if isinstance(offers, list) else [offers]
                for offer in offers_list:
                    if isinstance(offer, dict):
                        price = offer.get("price") or offer.get("lowPrice")
                        if price is not None:
                            try:
                                return float(str(price).replace(",", ""))
                            except ValueError:
                                continue
    return None


def _price_from_meta(soup: BeautifulSoup) -> float | None:
    for prop in ("og:price:amount", "product:price:amount"):
        tag = soup.find("meta", attrs={"property": prop})
        if tag and tag.get("content"):
            try:
                return float(str(tag["content"]).replace(",", ""))
            except ValueError:
                continue
    tag = soup.find(attrs={"itemprop": "price"})
    if tag:
        raw = tag.get("content") or tag.get_text()
        cleaned = re.sub(r"[^0-9.]", "", str(raw))
        if cleaned:
            try:
                return float(cleaned)
            except ValueError:
                pass
    return None


def extract_price(html: str) -> float:
    soup = BeautifulSoup(html, "html.parser")
    price = _price_from_jsonld(soup) or _price_from_meta(soup)
    if price is None or price <= 0:
        raise PriceCheckFailure("Couldn't find a price on the vendor page.")
    return price


# "Materially unchanged": within 1% or a cent, whichever is larger --
# absorbs rounding/format noise without hiding a real change.
def prices_match(estimate_price: float, fetched_price: float) -> bool:
    tolerance = max(0.01, estimate_price * 0.01)
    return abs(estimate_price - fetched_price) <= tolerance
