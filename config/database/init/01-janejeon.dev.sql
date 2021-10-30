CREATE DATABASE IF NOT EXISTS devblog;

CREATE USER IF NOT EXISTS 'ghost-devblog'@'localhost' IDENTIFIED BY 'ghost-devblog-password';
GRANT ALL PRIVILEGES ON devblog.* TO 'ghost-devblog'@'localhost';
