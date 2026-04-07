-- this user only exists to check that mysql is running
CREATE USER IF NOT EXISTS 'uptime-kuma'@'%' IDENTIFIED WITH caching_sha2_password BY 'uptime-kuma-password';
