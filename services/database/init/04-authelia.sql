CREATE DATABASE IF NOT EXISTS auth_db;

CREATE USER IF NOT EXISTS 'authelia'@'%' IDENTIFIED WITH mysql_native_password BY 'authelia-password';
GRANT ALL PRIVILEGES ON auth_db.* TO 'authelia'@'%';
