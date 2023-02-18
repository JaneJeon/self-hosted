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
  description = "Project containing all of the self hosted stack"
  environment = "Staging"
}

resource "digitalocean_tag" "tag_webserver" {
  name = "staging-webserver"
}

resource "digitalocean_tag" "tag_managed_by_terraform" {
  name = "staging-terraform"
}

resource "digitalocean_ssh_key" "ssh_key" {
  name       = "Self-Hosted (Staging) Default SSH Key"
  public_key = var.ssh_public_key
}
