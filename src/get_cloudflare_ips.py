import requests

CLOUDFLARE_IPV4_LIST_URL = "https://www.cloudflare.com/ips-v4"
CLOUDFLARE_IPV6_LIST_URL = "https://www.cloudflare.com/ips-v6"


def get_cloudflare_ips():
    ipv4s = requests.get(CLOUDFLARE_IPV4_LIST_URL).text.split("\n")
    ipv6s = requests.get(CLOUDFLARE_IPV6_LIST_URL).text.split("\n")

    ips = sorted(ipv4s + ipv6s)

    return ",".join(ips)
