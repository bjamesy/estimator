"""Debug tool: fetch a vendor product URL the same way check_vendor_price
does, report which price markup (if any) it contains, and save the raw
HTML for manual inspection.

Usage (inside the workers container, so the allowlist/network match prod):
    docker compose exec workers python scripts/dump_vendor_page.py <url> [output.html]
"""

import sys

from estimator_workers.vendor_price import (
    PriceCheckFailure,
    _price_from_jsonld,
    _price_from_meta,
    extract_price,
    fetch_page,
)
from bs4 import BeautifulSoup


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: python {sys.argv[0]} <url> [output.html]", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "vendor_page_dump.html"

    try:
        html = fetch_page(url)
    except PriceCheckFailure as exc:
        print(f"FETCH FAILED: {exc}")
        sys.exit(1)

    with open(out_path, "w") as f:
        f.write(html)

    soup = BeautifulSoup(html, "html.parser")
    print(f"length: {len(html)} bytes -- saved to {out_path}")
    print(f"has application/ld+json: {'application/ld+json' in html}")
    print(f"has og:price:amount meta: {'og:price:amount' in html}")
    print(f"has product:price:amount meta: {'product:price:amount' in html}")
    print(f"has itemprop=price: {bool(soup.find(attrs={'itemprop': 'price'}))}")
    print(f"jsonld price found: {_price_from_jsonld(soup)}")
    print(f"meta/itemprop price found: {_price_from_meta(soup)}")

    try:
        print(f"extract_price() result: {extract_price(html)}")
    except PriceCheckFailure as exc:
        print(f"extract_price() FAILED: {exc}")


if __name__ == "__main__":
    main()
