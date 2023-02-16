terraform {
  required_version = ">= 1.0.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.0.0, < 3.0.0"
    }

    b2 = {
      source  = "Backblaze/b2"
      version = ">= 0.8.1, < 1.0.0"
    }

    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 3.0.0, < 4.0.0"
    }
  }
}

provider "digitalocean" {}

provider "b2" {}

provider "cloudflare" {}

module "project" {
  source = "../../modules/project"

  name        = "Self Hosted"
  description = "Contains all of the self hosted stack"
  environment = "Staging"
}

module "ssh_key" {
  source = "../../modules/ssh"

  public_key = var.ssh_public_key
}
