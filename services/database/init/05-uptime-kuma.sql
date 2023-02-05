-- this user only exists to check that mysql is running
CREATE USER IF NOT EXISTS 'uptime-kuma'@'%' IDENTIFIED WITH mysql_native_password BY 'uptime-kuma-password';
