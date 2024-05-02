CREATE DATABASE IF NOT EXISTS devblog;

CREATE USER IF NOT EXISTS 'ghost-devblog'@'%' IDENTIFIED WITH caching_sha2_password BY 'ghost-devblog-password';
GRANT ALL PRIVILEGES ON devblog.* TO 'ghost-devblog'@'%';
