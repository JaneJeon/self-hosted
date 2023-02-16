terraform {
  required_version = ">= 1.0.0, < 2.0.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = ">= 2.0.0, < 3.0.0"
    }
  }
}

resource "digitalocean_project" "project" {
  name        = var.name
  description = var.description
  environment = var.environment
  # No `resources` block - use project_resources to explicitly link them together.
}
