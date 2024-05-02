CREATE DATABASE IF NOT EXISTS auth_db;

CREATE USER IF NOT EXISTS 'authelia'@'%' IDENTIFIED WITH caching_sha2_password BY 'authelia-password';
GRANT ALL PRIVILEGES ON auth_db.* TO 'authelia'@'%';
