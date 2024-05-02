CREATE DATABASE IF NOT EXISTS portfolio;

CREATE USER IF NOT EXISTS 'ghost-portfolio'@'%' IDENTIFIED WITH caching_sha2_password BY 'ghost-portfolio-password';
GRANT ALL PRIVILEGES ON portfolio.* TO 'ghost-portfolio'@'%';
