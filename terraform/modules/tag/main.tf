terraform {
  required_version = ">= 1.0.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.0.0, < 3.0.0"
    }
  }
}

resource "digitalocean_tag" "tag" {
  name = var.name
}
