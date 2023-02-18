terraform {
  required_version = ">= 1.0.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.0.0, < 3.0.0"
    }
  }
}

provider "digitalocean" {}

resource "digitalocean_project" "project" {
  name        = "Self Hosted"
  description = "Project containing all of the self hosted stack; managed by terraform"
  environment = "Staging"
}

# Simply create duplicate tags across environments, with a different name;
# this is because we do not want to be sharing resources across environments.
resource "digitalocean_tag" "webserver" {
  name = "staging-webserver"
}

resource "digitalocean_tag" "managed_by_terraform" {
  name = "staging-terraform"
}

# Same with the SSH Key; create a different one for isolation.
resource "digitalocean_ssh_key" "default" {
  name       = "Self-Hosted (Staging) Default SSH Key"
  public_key = var.ssh_public_key
}

locals {
  all_ports = "1-65535"
  all_ips   = ["0.0.0.0/0", "::/0"]
  # See src/get_cloudflare_ips.py
  cloudflare_ips = ["103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "104.16.0.0/13", "104.24.0.0/14", "108.162.192.0/18", "131.0.72.0/22", "141.101.64.0/18", "162.158.0.0/15", "172.64.0.0/13", "173.245.48.0/20", "188.114.96.0/20", "190.93.240.0/20", "197.234.240.0/22", "198.41.128.0/17", "2400:cb00::/32", "2405:8100::/32", "2405:b500::/32", "2606:4700::/32", "2803:f800::/32", "2a06:98c0::/29", "2c0f:f248::/32"]
}

# Same with firewalls; these can't be scoped to a project/environment "naturally" either.
resource "digitalocean_firewall" "webserver" {
  name = "staging-webserver-firewall"

  # Apply the firewall by linking to a tag, rather than to individual droplets.
  tags = [digitalocean_tag.webserver.name]

  # Port 22: Allow SSH
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = local.all_ips
  }

  # Port 80: Allow HTTP (only from Cloudflare)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = local.cloudflare_ips
  }

  # Port 443: Allow HTTPS (only from Cloudflare)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = local.cloudflare_ips
  }

  # TCP: Allow all outbound connections
  outbound_rule {
    protocol              = "tcp"
    port_range            = local.all_ports
    destination_addresses = local.all_ips
  }

  # UDP: Allow all outbound connections
  outbound_rule {
    protocol              = "udp"
    port_range            = local.all_ports
    destination_addresses = local.all_ips
  }
}

# Again, same deal here - artifically create different VPCs based on environment.
resource "digitalocean_vpc" "default" {
  name        = "staging-default-vpc"
  region      = var.region
  description = "Default VPC connecting self-hosted services for the staging environment"
}
