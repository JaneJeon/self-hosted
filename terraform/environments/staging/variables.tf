# See: https://docs.digitalocean.com/products/platform/availability-matrix/#available-datacenters
variable "region" {
  description = "The region for DigitalOcean services"
  type        = string
}

variable "ssh_public_key" {
  description = "The public key to add to DigitalOcean account and services"
  type        = string
}

variable "cloudflare_ips" {
  description = "IP addresses of Cloudflare; see src/get_cloudflare_ips.py"
  type        = list(string)
}
