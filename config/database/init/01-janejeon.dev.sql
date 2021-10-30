CREATE DATABASE IF NOT EXISTS devblog;

CREATE USER IF NOT EXISTS 'ghost-devblog'@'localhost' IDENTIFIED WITH mysql_native_password BY 'ghost-devblog-password';
GRANT ALL PRIVILEGES ON devblog.* TO 'ghost-devblog'@'localhost';
