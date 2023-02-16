output "fingerprint" {
  value       = digitalocean_ssh_key.default.fingerprint
  description = "Fingerprint of the created SSH Key"
}
