variable "name" {
  description = "Name of the default SSH Key to add"
  type        = string
  default     = "Default SSH Key"
}

variable "public_key" {
  description = "Value of the public SSH key to add"
  type        = string
}
