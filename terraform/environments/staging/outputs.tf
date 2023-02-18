output "managed_by_terraform_total_resources_count" {
  value       = digitalocean_tag.managed_by_terraform.total_resource_count
  description = "Total count of resources that are managed by terraform."
}

output "managed_by_terraform_droplets_count" {
  value       = digitalocean_tag.managed_by_terraform.droplets_count
  description = "Total count of droplets that are managed by terraform."
}

output "managed_by_terraform_volumes_count" {
  value       = digitalocean_tag.managed_by_terraform.volumes_count
  description = "Total count of volumes that are managed by terraform."
}

output "webserver_total_resources_count" {
  value       = digitalocean_tag.webserver.total_resource_count
  description = "Total count of webserver resources."
}

output "webserver_droplets_count" {
  value       = digitalocean_tag.webserver.droplets_count
  description = "Total count of webserver droplets."
}

output "webserver_volumes_count" {
  value       = digitalocean_tag.webserver.volumes_count
  description = "Total count of webserver volumes."
}
