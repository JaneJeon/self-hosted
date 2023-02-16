variable "name" {
  description = "Project name"
  type        = string
}

variable "description" {
  description = "Project description"
  type        = string
  default     = null
}

variable "environment" {
  description = "Project environment; must be one of Development/Staging/Production"
  type        = string
}
